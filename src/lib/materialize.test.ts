import { describe, it, expect } from "vitest";
import { computeMaterialize, type MaterializedRecord } from "./materialize";
import type { LapConfig } from "./preset";

// LAP-010 §9-1 のテスト対象。純関数 computeMaterialize を cutoff/startedAt 固定で網羅する（時刻非依存）。
// 完了全ブロック / 中断 work中 / 中断 break中 / 3h キャップ（ちょうど・work中・break中）/
// <60s 除外 / 日跨ぎ completedAt / breakSec=0 / cutoff 超過クランプ / 空 snapshot / work 終端境界。
// parsePresetConfig（snapshot narrowing）は LAP-008、deriveSessionState は LAP-009 で単体テスト済みのため、
// ここでは正規化済み LapConfig[] と固定 cutoff/startedAt を直接渡す（重複回避）。
// materializeSession / materializeIfDue / materializeOnAbort の DB I/O は単体テスト対象外（reviewer が接続を読みで確認）。

// 標準スナップショット S = [25/5 分, 50/10 分]。totalSec = 1500+300+3000+600 = 5400。
const S: LapConfig[] = [
  { workSec: 1500, breakSec: 300 },
  { workSec: 3000, breakSec: 600 },
];

const EPOCH = new Date("2026-06-22T00:00:00.000Z");

// cutoffSec（cutoff−startedAt）を固定して分解するヘルパ。
function run(cutoffSec: number, snapshot: LapConfig[] = S, startedAt: Date = EPOCH) {
  return computeMaterialize({
    snapshot,
    startedAt,
    cutoff: new Date(startedAt.getTime() + cutoffSec * 1000),
  });
}

// ブロックを lapIndex でひくユーティリティ（順序非依存に検証）。
function byLap(records: MaterializedRecord[], lapIndex: number) {
  return records.find((r) => r.lapIndex === lapIndex);
}

describe("computeMaterialize（学習記録の確定・§7.2 / §7.3 / §9-1）", () => {
  it("T-COMP（完了全ブロック）: cutoffSec=5400（=totalSec≤3h）→ 両 completed", () => {
    const r = run(5400);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.status === "completed")).toBe(true);
    expect(byLap(r, 0)).toMatchObject({
      status: "completed",
      plannedSeconds: 1500,
      countedSeconds: 1500,
    });
    expect(byLap(r, 1)).toMatchObject({
      status: "completed",
      plannedSeconds: 3000,
      countedSeconds: 3000,
    });
    // completedAt: lap0=startedAt+1500s, lap1=startedAt+(1800+3000)=4800s。
    expect(byLap(r, 0)!.completedAt.getTime()).toBe(EPOCH.getTime() + 1500 * 1000);
    expect(byLap(r, 1)!.startedAt.getTime()).toBe(EPOCH.getTime() + 1800 * 1000);
    expect(byLap(r, 1)!.completedAt.getTime()).toBe(EPOCH.getTime() + 4800 * 1000);
    expect(r.some((x) => x.status === "aborted")).toBe(false);
  });

  it("T-ABORT-WORK（中断が work 中）: cutoffSec=2800（lap1 work 開始から1000秒）", () => {
    const r = run(2800);
    expect(r).toHaveLength(2);
    expect(byLap(r, 0)).toMatchObject({ status: "completed", countedSeconds: 1500 });
    expect(byLap(r, 1)).toMatchObject({
      status: "aborted",
      countedSeconds: 1000,
      plannedSeconds: 3000,
    });
    // completedAt(lap1) = cutoff = startedAt+2800s。
    expect(byLap(r, 1)!.completedAt.getTime()).toBe(EPOCH.getTime() + 2800 * 1000);
  });

  it("T-BREAK（中断が break 中）: cutoffSec=1600（lap0 break 内 [1500,1800)）→ lap0 completed のみ", () => {
    const r = run(1600);
    expect(r).toHaveLength(1);
    expect(byLap(r, 0)).toMatchObject({ status: "completed", countedSeconds: 1500 });
    expect(r.some((x) => x.status === "aborted")).toBe(false); // §7.3 step4
  });

  it("T-CAP-EXACT（3h キャップちょうど・総時間=3h）: 両 completed", () => {
    const snapshot: LapConfig[] = [
      { workSec: 5400, breakSec: 0 },
      { workSec: 5400, breakSec: 0 },
    ];
    const r = run(10800, snapshot); // cutoffSec=totalSec=10800≤3h
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.status === "completed")).toBe(true);
    expect(byLap(r, 1)!.countedSeconds).toBe(5400);
  });

  it("T-CAP-WORK（総時間>3h・3h が work 中）: lap0 aborted(counted=10800)", () => {
    const snapshot: LapConfig[] = [{ workSec: 14400, breakSec: 0 }];
    const r = run(10800, snapshot); // 3h
    expect(r).toHaveLength(1);
    expect(byLap(r, 0)).toMatchObject({
      status: "aborted",
      countedSeconds: 10800,
      plannedSeconds: 14400,
    });
    // completedAt = cutoff = startedAt+3h。
    expect(byLap(r, 0)!.completedAt.getTime()).toBe(EPOCH.getTime() + 10800 * 1000);
  });

  it("T-CAP-BREAK（総時間>3h・3h が break 中）: lap0 completed のみ・aborted 0 件", () => {
    const snapshot: LapConfig[] = [
      { workSec: 9000, breakSec: 3600 }, // break [9000,12600) に 3h=10800 が当たる
      { workSec: 9000, breakSec: 0 },
    ];
    const r = run(10800, snapshot);
    expect(r).toHaveLength(1);
    expect(byLap(r, 0)).toMatchObject({ status: "completed", countedSeconds: 9000 });
    expect(r.some((x) => x.status === "aborted")).toBe(false); // §7.3 step4・3h が break
  });

  it("T-SHORT（<60s 除外）: cutoffSec=30 → 0 件", () => {
    const snapshot: LapConfig[] = [{ workSec: 1500, breakSec: 0 }];
    const r = run(30, snapshot);
    expect(r).toHaveLength(0); // aborted(counted=30) は <60 で除外
  });

  it("T-SHORT-MIX（completed は残り <60s aborted のみ除外）: cutoffSec=1840", () => {
    const snapshot: LapConfig[] = [
      { workSec: 1500, breakSec: 300 },
      { workSec: 1500, breakSec: 0 },
    ];
    const r = run(1840, snapshot); // lap1 work 開始から 40 秒
    expect(r).toHaveLength(1);
    expect(byLap(r, 0)).toMatchObject({ status: "completed", countedSeconds: 1500 });
    expect(byLap(r, 1)).toBeUndefined(); // aborted(counted=40<60) は除外
  });

  it("T-CROSSDAY（日跨ぎ completedAt）: startedAt=23:40Z・cutoffSec=5400 → lap1 completedAt は翌日", () => {
    const start = new Date("2026-06-22T23:40:00.000Z");
    const r = run(5400, S, start);
    expect(r).toHaveLength(2);
    // lap1 completedAt = start + 4800s = 23:40:00 + 1:20:00 = 翌 01:00:00Z（分割せずそのまま・§7.4）。
    const expected = new Date(start.getTime() + 4800 * 1000);
    expect(byLap(r, 1)!.completedAt.toISOString()).toBe("2026-06-23T01:00:00.000Z");
    expect(byLap(r, 1)!.completedAt.getTime()).toBe(expected.getTime());
  });

  it("T-BREAK0（breakSec=0・work 連続）: cutoffSec=900 → lap0 completed, lap1 aborted(300)", () => {
    const snapshot: LapConfig[] = [
      { workSec: 600, breakSec: 0 },
      { workSec: 600, breakSec: 0 },
    ];
    const r = run(900, snapshot); // lap1 work 開始(=600s)から 300 秒
    expect(r).toHaveLength(2);
    expect(byLap(r, 0)).toMatchObject({ status: "completed", countedSeconds: 600 });
    expect(byLap(r, 1)).toMatchObject({ status: "aborted", countedSeconds: 300 });
    expect(byLap(r, 1)!.startedAt.getTime()).toBe(EPOCH.getTime() + 600 * 1000);
  });

  it("T-CLAMP（cutoff がラン終端超過）: cutoffSec=9999（>5400）→ 両 completed 頭打ち", () => {
    const r = run(9999); // totalSec=5400 にクランプ
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.status === "completed")).toBe(true);
    expect(byLap(r, 1)!.countedSeconds).toBe(3000);
  });

  it("T-EMPTY（空 snapshot）: 0 件", () => {
    expect(run(1000, [])).toHaveLength(0);
    expect(run(0, [])).toHaveLength(0);
  });

  it("T-BOUNDARY（work 終端ちょうど = completed）: cutoffSec=1500", () => {
    const snapshot: LapConfig[] = [{ workSec: 1500, breakSec: 300 }];
    const r = run(1500, snapshot); // work [0,1500) 終端ちょうど
    expect(r).toHaveLength(1);
    expect(byLap(r, 0)).toMatchObject({ status: "completed", countedSeconds: 1500 });
  });

  it("T-ZERO（cutoffSec=0）: 0 件（開始ちょうど・何も確定しない）", () => {
    expect(run(0)).toHaveLength(0);
  });

  it("T-NEG（cutoff < startedAt の負経過）: 0 件（クランプ）", () => {
    const r = computeMaterialize({
      snapshot: S,
      startedAt: EPOCH,
      cutoff: new Date(EPOCH.getTime() - 5000),
    });
    expect(r).toHaveLength(0);
  });
});
