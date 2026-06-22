"use client";

import { useEffect, useState } from "react";
import type { LapConfig } from "@/lib/preset";
import {
  deriveSessionState,
  segmentProgressRatio,
  type SessionState,
} from "@/lib/session";

// 進行中ランのライブカウント表示（LAP-009 §3-5 / §4-D / LAP-015 WF 07 実行モード）。"use client"。
// 状態の正はサーバー（initial = Server Component が deriveSessionState で導出した値・再 open はサーバー再導出）。
// クライアントは startedAt(ISO) を起点に「クライアント時計の差分でカウントアップ」するだけの表示層であり、
// localStorage 等のクライアント永続化は使わない。導出ロジックは server と同じ deriveSessionState を再利用し、
// クライアント側でも startedAt + snapshot + Date() から現セグメント/expired を毎秒再計算する（表示用途）。
//
// LAP-015: WF の timer-ring（円形進捗）/ timer-big（残り時間）/ run-meta / prog（進捗バー）を描画する。
// リング・バーは state（segmentElapsedSec/segmentTotalSec）から segmentProgressRatio で算出するのみ
// （props 契約・deriveSessionState・サーバー時刻基準は不変）。中断フォームはこのカード内に内包する
// （abortAction/sessionId を props で受ける・name="id" は不変）。

function formatClock(totalSec: number): string {
  const safe = totalSec > 0 ? totalSec : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseLabel(phase: SessionState["phase"]): string {
  switch (phase) {
    case "work":
      return "作業中";
    case "break":
      return "休憩中";
    case "expired":
      return "確定待ち";
  }
}

export function SessionTimer({
  initial,
  startedAt,
  snapshot,
  abortAction,
  sessionId,
}: {
  initial: SessionState;
  startedAt: string; // ISO 文字列（サーバーが渡す startedAt）。カウントの基準。
  snapshot: LapConfig[];
  abortAction: (formData: FormData) => void | Promise<void>; // server action（abortSession）。
  sessionId: string; // hidden name="id" の値（不変）。
}) {
  // 起点はサーバー導出の initial。以降はクライアント時計で毎秒再導出する（表示用カウントアップ）。
  const [state, setState] = useState<SessionState>(initial);

  useEffect(() => {
    const startedAtDate = new Date(startedAt);

    const tick = () => {
      setState(
        deriveSessionState({
          snapshot,
          startedAt: startedAtDate,
          now: new Date(),
        }),
      );
    };

    // 即時に一度同期（マウント時刻と initial 算出時刻のズレを詰める）。
    tick();
    // expired に到達したらカウントを止める（confirm 待ちの静的表示・§3-5）。
    if (state.expired) return;

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // initial を起点に startedAt/snapshot が変われば貼り直す。state.expired は意図的に依存に含めない
    // （expired 到達時は tick 内で expired:true がセットされ、次回 effect 再評価で interval を張らない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, snapshot, state.expired]);

  // 中断フォーム（WF .btn.ghost.sm「中断して記録」）。name="id" は不変。
  const abortForm = (
    <form action={abortAction} className="mt-4">
      <input type="hidden" name="id" value={sessionId} />
      <button
        type="submit"
        className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-line-2 px-4 text-xs text-ink"
      >
        中断して記録
      </button>
    </form>
  );

  if (state.expired) {
    return (
      <div className="rounded-card border border-line bg-panel p-6 text-center">
        <p className="font-[family-name:var(--font-fredoka)] text-sm font-semibold text-ink">
          確定期限に到達しました。
        </p>
        <p className="mt-1 text-xs text-ink-dim">
          記録への反映は参照時の遅延評価で確定されます（集計反映は LAP-010 / 011）。
        </p>
        {abortForm}
      </div>
    );
  }

  const remaining = state.segmentTotalSec - state.segmentElapsedSec;
  const ratio = segmentProgressRatio(state);

  return (
    <div className="rounded-card border border-line bg-card p-6 text-center">
      {/* リング（conic-gradient で円弧進捗・中央くり抜きは内側 bg-card 円）。 */}
      <div
        className="mx-auto mb-4 flex h-[180px] w-[180px] items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(var(--color-progress) ${ratio * 360}deg, var(--color-fill) 0)`,
        }}
      >
        <div className="flex h-[150px] w-[150px] items-center justify-center rounded-full bg-card">
          <span className="font-[family-name:var(--font-fredoka)] text-[40px] font-semibold tabular-nums text-ink">
            {formatClock(remaining)}
          </span>
        </div>
      </div>

      <div className="text-xs text-ink-dim">
        {state.lapIndex + 1} / {snapshot.length} ラップ目 ・{" "}
        <b className="font-semibold text-ink">{phaseLabel(state.phase)}</b>
      </div>

      {/* 進捗バー（現セグメントの進捗率）。 */}
      <div className="my-3 h-2 overflow-hidden rounded bg-fill">
        <i
          className="block h-full bg-progress"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      <div className="text-xs text-ink-dim">
        累計経過 {formatClock(state.elapsedSec)} ・ サーバー時刻基準で算出
      </div>

      {abortForm}
    </div>
  );
}
