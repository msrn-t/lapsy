import { describe, it, expect } from "vitest";
import {
  deriveSessionState,
  segmentProgressRatio,
  MAX_RUN_SECONDS,
  type DeriveSessionInput,
  type SessionState,
} from "./session";
import type { LapConfig } from "./preset";

// LAP-009 §9-1 のテスト対象。純関数 deriveSessionState を now 固定で網羅する（時刻非依存）。
// work/break 境界（半開区間の下端は次セグメントへ）・breakSec=0 スキップ・確定期限ちょうど/超過・
// 3h キャップ・負経過クランプ・totalSec/deadlineSec の整合を検証する。
// parsePresetConfig（snapshot narrowing）は LAP-008 で単体テスト済みのため、ここでは正規化済み
// LapConfig[] を直接渡す（再テストは重複回避）。

// 標準スナップショット S = [25/5 分, 50/10 分]。totalSec = 1500+300+3000+600 = 5400。
const S: LapConfig[] = [
  { workSec: 1500, breakSec: 300 },
  { workSec: 3000, breakSec: 600 },
];

const EPOCH = new Date("2026-06-22T00:00:00.000Z");

// 経過秒（now - startedAt）を固定して状態を導出するヘルパ。
function at(elapsedSec: number, snapshot: LapConfig[] = S) {
  const input: DeriveSessionInput = {
    snapshot,
    startedAt: EPOCH,
    now: new Date(EPOCH.getTime() + elapsedSec * 1000),
  };
  return deriveSessionState(input);
}

describe("deriveSessionState（サーバー時刻基準の状態導出・§7.3 / §9-1）", () => {
  it("T1: 経過 0（開始直後）は lap0 work 先頭", () => {
    const s = at(0);
    expect(s.phase).toBe("work");
    expect(s.lapIndex).toBe(0);
    expect(s.segmentElapsedSec).toBe(0);
    expect(s.segmentTotalSec).toBe(1500);
    expect(s.expired).toBe(false);
  });

  it("T2: 経過 1499（lap0 work 末尾直前）", () => {
    const s = at(1499);
    expect(s.phase).toBe("work");
    expect(s.lapIndex).toBe(0);
    expect(s.segmentElapsedSec).toBe(1499);
    expect(s.expired).toBe(false);
  });

  it("T3: 経過 1500（lap0 work→break 境界ちょうど・半開区間下端は次へ）", () => {
    const s = at(1500);
    expect(s.phase).toBe("break");
    expect(s.lapIndex).toBe(0);
    expect(s.segmentElapsedSec).toBe(0);
    expect(s.segmentTotalSec).toBe(300);
    expect(s.expired).toBe(false);
  });

  it("T4: 経過 1799（lap0 break 末尾直前）", () => {
    const s = at(1799);
    expect(s.phase).toBe("break");
    expect(s.lapIndex).toBe(0);
    expect(s.segmentElapsedSec).toBe(299);
    expect(s.expired).toBe(false);
  });

  it("T5: 経過 1800（lap0 break→lap1 work 境界）", () => {
    const s = at(1800);
    expect(s.phase).toBe("work");
    expect(s.lapIndex).toBe(1);
    expect(s.segmentElapsedSec).toBe(0);
    expect(s.segmentTotalSec).toBe(3000);
    expect(s.expired).toBe(false);
  });

  it("T6: 経過 5399（確定期限直前・totalSec=5400・最終 break 内）", () => {
    const s = at(5399);
    expect(s.phase).toBe("break");
    expect(s.lapIndex).toBe(1);
    expect(s.expired).toBe(false);
  });

  it("T7: 経過 5400（= totalSec = 確定期限・総時間≤3h）は expired", () => {
    const s = at(5400);
    expect(s.phase).toBe("expired");
    expect(s.expired).toBe(true);
  });

  it("T8: 経過 6000（確定期限超過）は expired", () => {
    const s = at(6000);
    expect(s.phase).toBe("expired");
    expect(s.expired).toBe(true);
  });

  it("T9: breakSec=0 を含む snapshot・経過 60 で lap0 break 長さ0 をスキップし lap1 work へ", () => {
    const snapshot: LapConfig[] = [
      { workSec: 60, breakSec: 0 },
      { workSec: 60, breakSec: 0 },
    ];
    const s = at(60, snapshot);
    expect(s.phase).toBe("work");
    expect(s.lapIndex).toBe(1);
    expect(s.segmentElapsedSec).toBe(0);
    expect(s.expired).toBe(false);
  });

  it("T10: breakSec=0 のみ・経過 59（lap0 work 内）", () => {
    const snapshot: LapConfig[] = [
      { workSec: 60, breakSec: 0 },
      { workSec: 60, breakSec: 0 },
    ];
    const s = at(59, snapshot);
    expect(s.phase).toBe("work");
    expect(s.lapIndex).toBe(0);
    expect(s.segmentElapsedSec).toBe(59);
  });

  it("T11: 総時間 > 3h・経過 10800（=3h）は expired（3h キャップ＝確定期限）", () => {
    // [{work:14400,break:0}] ×2 → totalSec=28800、deadlineSec=10800。
    const snapshot: LapConfig[] = [
      { workSec: 14400, breakSec: 0 },
      { workSec: 14400, breakSec: 0 },
    ];
    const s = at(MAX_RUN_SECONDS, snapshot); // 10800
    expect(s.phase).toBe("expired");
    expect(s.expired).toBe(true);
    expect(s.deadlineSec).toBe(MAX_RUN_SECONDS);
  });

  it("T12: 同 T11・経過 10799（3h 直前）はまだ進行中（work）", () => {
    const snapshot: LapConfig[] = [
      { workSec: 14400, breakSec: 0 },
      { workSec: 14400, breakSec: 0 },
    ];
    const s = at(MAX_RUN_SECONDS - 1, snapshot); // 10799
    expect(s.expired).toBe(false);
    expect(s.phase).toBe("work");
    expect(s.lapIndex).toBe(0);
  });

  it("T13: now < startedAt（負の経過）は elapsedSec=0 へクランプし lap0 work", () => {
    const input: DeriveSessionInput = {
      snapshot: S,
      startedAt: EPOCH,
      now: new Date(EPOCH.getTime() - 5000), // 5 秒巻き戻り
    };
    const s = deriveSessionState(input);
    expect(s.elapsedSec).toBe(0);
    expect(s.phase).toBe("work");
    expect(s.lapIndex).toBe(0);
    expect(s.segmentElapsedSec).toBe(0);
  });

  it("T14: deadlineSec の算出（totalSec ≤ 3h は totalSec / totalSec > 3h は 10800）", () => {
    // totalSec ≤ 3h: S（5400）→ deadlineSec=5400。
    expect(at(0).deadlineSec).toBe(5400);
    // totalSec > 3h: 28800 → deadlineSec=10800。
    const over: LapConfig[] = [
      { workSec: 14400, breakSec: 0 },
      { workSec: 14400, breakSec: 0 },
    ];
    expect(at(0, over).deadlineSec).toBe(MAX_RUN_SECONDS);
  });

  it("T15: totalSec が Σ(work+break) と一致する（複数ラップ累計）", () => {
    expect(at(0).totalSec).toBe(1500 + 300 + 3000 + 600); // 5400
  });
});

describe("segmentProgressRatio（現セグメント進捗率・LAP-015 timer-ring/prog）", () => {
  const base: SessionState = {
    phase: "work",
    lapIndex: 0,
    totalSec: 5400,
    deadlineSec: 5400,
    elapsedSec: 0,
    segmentElapsedSec: 0,
    segmentTotalSec: 1500,
    expired: false,
  };

  it("経過 0 → 0", () => {
    expect(segmentProgressRatio({ ...base, segmentElapsedSec: 0 })).toBe(0);
  });

  it("半分経過 → 0.5", () => {
    expect(
      segmentProgressRatio({ ...base, segmentElapsedSec: 750, segmentTotalSec: 1500 }),
    ).toBe(0.5);
  });

  it("expired は 1（満杯）", () => {
    expect(
      segmentProgressRatio({
        ...base,
        phase: "expired",
        expired: true,
        segmentElapsedSec: 0,
        segmentTotalSec: 0,
      }),
    ).toBe(1);
  });

  it("segmentTotalSec=0（空セグメント）は 1（0 除算回避）", () => {
    expect(
      segmentProgressRatio({ ...base, segmentElapsedSec: 0, segmentTotalSec: 0 }),
    ).toBe(1);
  });

  it("超過分は 1 にクランプ", () => {
    expect(
      segmentProgressRatio({ ...base, segmentElapsedSec: 2000, segmentTotalSec: 1500 }),
    ).toBe(1);
  });

  it("segmentTotalSec が負値（防御）は 1（0 除算/負割回避）", () => {
    expect(
      segmentProgressRatio({ ...base, segmentElapsedSec: 0, segmentTotalSec: -100 }),
    ).toBe(1);
  });

  it("segmentElapsedSec が負値（防御・時計巻き戻り想定）は 0 にクランプ", () => {
    expect(
      segmentProgressRatio({ ...base, segmentElapsedSec: -50, segmentTotalSec: 1500 }),
    ).toBe(0);
  });
});
