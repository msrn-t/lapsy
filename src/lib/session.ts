// ポモドーロ実行（ラン）のサーバー時刻基準の状態導出純ロジック（LAP-009 §3-2 / SPEC §7.3）。
// DB に非依存・書き込みなし。startedAt（DB 値）と now（サーバー現在時刻）の差だけを根拠に
// 「今どのラップの作業/休憩区間か・現セグメント経過・累計経過・確定期限・expired か」を導出する。
// クライアント時計は一切信頼しない（改ざん対策・§7.3）。now は引数注入で時刻非依存にし単体テストする
// （topic.ts の computeArchiveMutation(now) の前例）。presetSnapshot は読込後 parsePresetConfig で
// narrowing 済みの LapConfig[] を渡す前提（本関数は再 narrowing しない・§3-1）。
//
// materialize（StudyRecord 生成・completed/aborted 確定）は LAP-010 の責務。本関数は確定期限を
// 経過したランに対して phase:"expired" を返すのみで、状態を一切書き換えない（§3-3）。

import type { LapConfig } from "@/lib/preset"; // presetSnapshot の要素型を共有（§7.1 / LAP-008）

/** 終了し忘れ対策の確定キャップ（3 時間・SPEC §4 Should / §7.3）。 */
export const MAX_RUN_SECONDS = 3 * 60 * 60; // 10800

/** 進行中の現在位置の種別。 */
export type SessionPhase =
  | "work" // 現在は作業区間
  | "break" // 現在は休憩区間
  | "expired"; // 確定期限を経過済み（materialize 待ち・LAP-010）。本チケットは書き込まない

export type DeriveSessionInput = {
  snapshot: LapConfig[]; // 凍結済みラップ構成（parsePresetConfig で narrowing 済みを渡す）
  startedAt: Date; // DB の startedAt（サーバー時刻が正）
  now: Date; // 評価時点のサーバー現在時刻（new Date() を注入。テストは固定値）
};

export type SessionState = {
  phase: SessionPhase; // work / break / expired
  lapIndex: number; // 0 始まりの現ラップ番号。expired のときは最終ラップ index
  totalSec: number; // ラン総時間 Σ(workSec+breakSec)
  deadlineSec: number; // 確定期限 = min(totalSec, MAX_RUN_SECONDS)
  elapsedSec: number; // startedAt からの累計経過秒（floor。負なら 0 へクランプ）
  segmentElapsedSec: number; // 現セグメント（現ラップの work か break）内の経過秒。expired のときは 0
  segmentTotalSec: number; // 現セグメントの総秒数（workSec or breakSec）。expired のときは 0
  expired: boolean; // elapsedSec >= deadlineSec（= phase==="expired"）。UI/LAP-010 の境界
};

/**
 * 進行中ランのサーバー時刻基準の状態を導出する純関数（§7.3・書き込みなし）。
 *
 * アルゴリズム:
 *   1. elapsedSec = max(0, floor((now - startedAt)/1000))  // 負経過は 0 へクランプ（クロックスキュー堅牢性・T13）
 *   2. totalSec = Σ(snapshot[i].workSec + snapshot[i].breakSec)
 *      deadlineSec = min(totalSec, MAX_RUN_SECONDS)        // 3h キャップ（§3-2 / T11,T14）
 *   3. elapsedSec >= deadlineSec なら expired を返す（最終ラップ index・materialize は LAP-010・§3-3）
 *   4. それ以外: snapshot を先頭から走査し、累積境界 acc に対して半開区間 [acc, acc+sec) で現在位置を決める。
 *        work セグメント [acc, acc+workSec): 入れば phase="work"
 *        break セグメント [acc, acc+breakSec): 入れば phase="break"
 *      ※ breakSec=0 の break セグメントは長さ0 → 半開区間が空 → 必ずスキップ（§3-2 / T9,T10）
 *   5. 浮動小数/境界の保険として、4 でヒットしなければ最終 work セグメントへフォールバックする。
 */
export function deriveSessionState(input: DeriveSessionInput): SessionState {
  const { snapshot, startedAt, now } = input;

  // 1. 累計経過秒（負はクランプ・floor で整数秒化）。
  const rawElapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
  const elapsedSec = rawElapsed > 0 ? rawElapsed : 0;

  // 2. ラン総時間と確定期限。
  let totalSec = 0;
  for (const lap of snapshot) {
    totalSec += lap.workSec + lap.breakSec;
  }
  const deadlineSec = Math.min(totalSec, MAX_RUN_SECONDS);

  const lastLapIndex = snapshot.length > 0 ? snapshot.length - 1 : 0;

  // 3. 確定期限を経過済み → expired を返すのみ（status も StudyRecord も変えない・§3-3）。
  if (elapsedSec >= deadlineSec) {
    return {
      phase: "expired",
      lapIndex: lastLapIndex,
      totalSec,
      deadlineSec,
      elapsedSec,
      segmentElapsedSec: 0,
      segmentTotalSec: 0,
      expired: true,
    };
  }

  // 4. 半開区間 [acc, acc+sec) でラップ列を消化し現在位置を特定する。
  let acc = 0;
  for (let i = 0; i < snapshot.length; i++) {
    const { workSec, breakSec } = snapshot[i];

    // work セグメント。
    if (elapsedSec >= acc && elapsedSec < acc + workSec) {
      return {
        phase: "work",
        lapIndex: i,
        totalSec,
        deadlineSec,
        elapsedSec,
        segmentElapsedSec: elapsedSec - acc,
        segmentTotalSec: workSec,
        expired: false,
      };
    }
    acc += workSec;

    // break セグメント（breakSec=0 は長さ0 → 半開区間が空で必ずスキップ・§3-2）。
    if (elapsedSec >= acc && elapsedSec < acc + breakSec) {
      return {
        phase: "break",
        lapIndex: i,
        totalSec,
        deadlineSec,
        elapsedSec,
        segmentElapsedSec: elapsedSec - acc,
        segmentTotalSec: breakSec,
        expired: false,
      };
    }
    acc += breakSec;
  }

  // 5. 理論上ここには到達しない（elapsedSec < deadlineSec なら 4 で必ずヒット）。
  // 浮動小数/境界の保険として最終 work セグメントへフォールバックする。
  const lastLap = snapshot[lastLapIndex];
  return {
    phase: "work",
    lapIndex: lastLapIndex,
    totalSec,
    deadlineSec,
    elapsedSec,
    segmentElapsedSec: 0,
    segmentTotalSec: lastLap ? lastLap.workSec : 0,
    expired: false,
  };
}
