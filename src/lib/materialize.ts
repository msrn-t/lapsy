// 学習記録の確定（materialize・LAP-010 §3 / SPEC §7.2 / §7.3）。
// 2 層構成: (1) DB 非依存の純ロジック computeMaterialize（cutoff までの作業ブロックを
// StudyRecord 相当の配列へ分解）、(2) I/O 層 materializeSession / materializeIfDue
// （status guard + $transaction で冪等に StudySession を確定し StudyRecord を生成）。
//
// LAP-009 の deriveSessionState と同じ「半開区間 [acc, acc+sec)」モデルでブロック列挙する。
// クライアント時計は信頼しない（cutoff はサーバー時刻由来）。純関数は cutoff/startedAt を
// 引数注入して時刻非依存に単体テストする（materialize.test.ts・§9）。

import { Prisma } from "@prisma/client";
import type { LapConfig } from "@/lib/preset";
import { parsePresetConfig } from "@/lib/preset"; // JSONB を信頼しない narrowing（§3-4）
import { MAX_RUN_SECONDS } from "@/lib/session"; // 3h キャップ（既存 export を非破壊再利用・§3-0）
import { prisma } from "@/lib/prisma";

/** computeMaterialize が返す StudyRecord 相当のプレーンオブジェクト（DB 列名に揃える）。 */
export type MaterializedRecord = {
  lapIndex: number; // ラン内のラップ番号（0 始まり）
  plannedSeconds: number; // そのラップの計画作業秒（= snapshot[i].workSec）
  countedSeconds: number; // completed=workSec / aborted=実作業秒（cutoffSec-accWork）
  status: "completed" | "aborted"; // RecordStatus と一致
  startedAt: Date; // ブロック開始の実時刻 = ラン startedAt + accWork 秒（UTC）
  completedAt: Date; // completed=ブロック終端 / aborted=cutoff（UTC・日割りは LAP-011）
};

export type ComputeMaterializeInput = {
  snapshot: LapConfig[]; // 凍結ラップ構成（parsePresetConfig で narrowing 済みを渡す）
  startedAt: Date; // ラン開始（DB の startedAt）
  cutoff: Date; // 確定点（中断=endedAt / 遅延評価=min(startedAt+totalSec, startedAt+3h)）
};

/** 記録対象の最小作業秒（§7.3: countedSeconds < 60 のブロックは除外）。 */
const MIN_COUNTED_SECONDS = 60;

/**
 * 確定点 cutoff までに確定すべき作業ブロックを StudyRecord 相当の配列へ分解する純関数（§3-2）。
 *
 * - 完全終了 work = completed（countedSeconds=plannedSeconds=workSec）
 * - cutoff が work 途中 = aborted（countedSeconds=cutoffSec-accWork の実作業秒）でランは終了
 * - cutoff が break 途中/境界 = 直前 work は completed 済み・部分記録なし（§7.3 step4）
 * - 休憩区間は記録しない（§7.2）／ countedSeconds<60 のブロックは最後に除外（§7.3）
 * - completedAt は UTC Date をそのまま書く（Asia/Tokyo 日割りは LAP-011・§7.4）
 * - cutoffSec は内部で min(.., totalSec) にクランプ（ラン終端超過→全 completed 頭打ち・§3-1）
 */
export function computeMaterialize(
  input: ComputeMaterializeInput,
): MaterializedRecord[] {
  const { snapshot, startedAt, cutoff } = input;

  // ラン総時間（cutoff のクランプ上限）。
  let totalSec = 0;
  for (const lap of snapshot) {
    totalSec += lap.workSec + lap.breakSec;
  }

  // 確定点を秒に変換。負はクランプし、ラン終端を超えても頭打ち（§3-1）。
  const rawCutoffSec = Math.floor((cutoff.getTime() - startedAt.getTime()) / 1000);
  const cutoffSec = Math.min(Math.max(0, rawCutoffSec), totalSec);

  const startMs = startedAt.getTime();
  const records: MaterializedRecord[] = [];
  let acc = 0; // 累積秒（work/break セグメント開始境界）。

  for (let i = 0; i < snapshot.length; i++) {
    const { workSec, breakSec } = snapshot[i];
    const accWork = acc; // この work セグメント開始の累積秒。

    // cutoff より後に始まる work は未着手 → 以降は記録しない。
    if (cutoffSec <= accWork) {
      break;
    }

    const blockStartedAt = new Date(startMs + accWork * 1000);

    if (cutoffSec >= accWork + workSec) {
      // 完全終了 work → completed（計画値・§7.2）。
      records.push({
        lapIndex: i,
        plannedSeconds: workSec,
        countedSeconds: workSec,
        status: "completed",
        startedAt: blockStartedAt,
        completedAt: new Date(startMs + (accWork + workSec) * 1000),
      });
    } else {
      // accWork <= cutoffSec < accWork+workSec → cutoff が work 途中 → aborted（実作業秒・§7.2）。
      const counted = cutoffSec - accWork; // 実作業秒（≥0）
      records.push({
        lapIndex: i,
        plannedSeconds: workSec,
        countedSeconds: counted,
        status: "aborted",
        startedAt: blockStartedAt,
        completedAt: new Date(startMs + cutoffSec * 1000), // = cutoff
      });
      break; // aborted ブロックでランは終わる。
    }

    // break セグメントは記録対象外（§7.2）。次 work の境界まで accumulate するのみ。
    // cutoff が break 途中で当たっても直前 work は上で completed 済み・部分記録なし（§7.3 step4）。
    acc += workSec;
    acc += breakSec;
  }

  // <60s 除外（§7.3）。completed は workSec≥60 で常に通過、aborted の極小部分のみ除外。
  return records.filter((r) => r.countedSeconds >= MIN_COUNTED_SECONDS);
}

// ── I/O 層（DB 書き込み・冪等。$transaction の tx を受け取る）──

export type MaterializeOutcome = { materialized: boolean };

/** materialize の対象となる running StudySession の最小フィールド（クライアント非依存の値のみ使う）。 */
export type RunningSession = {
  id: string;
  userId: string;
  topicId: string;
  startedAt: Date;
};

/**
 * status guard（updateMany running）の count===1 を勝者にし、勝者のみ createMany(StudyRecord)（§3-3）。
 * targetStatus は computeMaterialize の結果に aborted ブロックがあれば "aborted"、無ければ "completed"。
 * Prisma.TransactionClient を受け取り、呼び出し側の $transaction 内で原子化する（invite/password-reset 同型）。
 *
 * - count===0（敗者）: 既に別リクエストが確定済み → 何もしない（冪等・StudyRecord 二重生成なし）。
 * - records.length===0（<60s 全除外 / 空 snapshot）: StudyRecord は作らないが status は遷移させる
 *   （running を放置しない・§3-3）。
 */
export async function materializeSession(
  tx: Prisma.TransactionClient,
  session: RunningSession,
  snapshot: LapConfig[],
  cutoff: Date,
): Promise<MaterializeOutcome> {
  const records = computeMaterialize({
    snapshot,
    startedAt: session.startedAt,
    cutoff,
  });

  // aborted ブロックがあれば中断確定、無ければ（全 completed or 0 件）完了確定（§3-3）。
  const targetStatus: "completed" | "aborted" = records.some(
    (r) => r.status === "aborted",
  )
    ? "aborted"
    : "completed";

  // 1. 状態遷移を勝者条件にする（並行リクエストで 1 回だけ通る・§3-3）。
  const { count } = await tx.studySession.updateMany({
    where: { id: session.id, userId: session.userId, status: "running" },
    data: { status: targetStatus, endedAt: cutoff },
  });
  if (count === 0) {
    return { materialized: false }; // 既に確定済み（敗者）→ 何もしない（冪等）。
  }

  // 2. 勝者のみ StudyRecord を生成（同一 Tx 内で原子化）。
  if (records.length > 0) {
    await tx.studyRecord.createMany({
      data: records.map((r) => ({
        sessionId: session.id,
        userId: session.userId, // session 行の値（クライアント非依存・§6 データ分離）
        topicId: session.topicId, // session 行の値（クライアント非依存）
        lapIndex: r.lapIndex,
        plannedSeconds: r.plannedSeconds,
        countedSeconds: r.countedSeconds,
        status: r.status,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    });
  }

  return { materialized: true };
}

/** materializeIfDue / materializeOnAbort に渡す running 行（presetSnapshot は JSONB のまま）。 */
export type RunningSessionWithSnapshot = RunningSession & {
  presetSnapshot: unknown;
};

/**
 * 遅延評価エントリ（§3-4）。now が確定期限以降なら $transaction で materializeSession を回す。
 * 確定期限前（due:false）は何もしない。再 open / 参照 / 集計入口（LAP-011）から呼ぶ。
 *
 * cutoff = min(startedAt+totalSec, startedAt+3h)。発火条件 elapsedSec >= cutoffSec（= LAP-009 expired）。
 */
export async function materializeIfDue(
  session: RunningSessionWithSnapshot,
  now: Date,
): Promise<{ due: boolean } & Partial<MaterializeOutcome>> {
  const snapshot = parsePresetConfig(session.presetSnapshot); // JSONB を信頼しない（§3-4）

  let totalSec = 0;
  for (const lap of snapshot) {
    totalSec += lap.workSec + lap.breakSec;
  }
  const cutoffSec = Math.min(totalSec, MAX_RUN_SECONDS); // §3-1 (b)

  const elapsedSec = Math.floor(
    (now.getTime() - session.startedAt.getTime()) / 1000,
  );
  if (elapsedSec < cutoffSec) {
    return { due: false }; // まだ確定期限前 → 何もしない。
  }

  const cutoff = new Date(session.startedAt.getTime() + cutoffSec * 1000);
  const outcome = await prisma.$transaction((tx) =>
    materializeSession(tx, session, snapshot, cutoff),
  );
  return { due: true, ...outcome };
}

/**
 * ユーザー中断の確定エントリ（§3-4 経路 (2)）。cutoff=abortedAt（サーバー時刻）で
 * due 判定を経ず直接 materialize する（中断は今すぐ確定）。materializeSession を共有し
 * ロジック重複を避ける。targetStatus は materialize 結果で決まる（中断が break/境界なら
 * 全 completed → status=completed になり得る・§3-3）。
 */
export async function materializeOnAbort(
  session: RunningSessionWithSnapshot,
  abortedAt: Date,
): Promise<MaterializeOutcome> {
  const snapshot = parsePresetConfig(session.presetSnapshot); // JSONB を信頼しない
  return prisma.$transaction((tx) =>
    materializeSession(tx, session, snapshot, abortedAt),
  );
}
