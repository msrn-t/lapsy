"use client";

import { useEffect, useState } from "react";
import type { LapConfig } from "@/lib/preset";
import { deriveSessionState, type SessionState } from "@/lib/session";

// 進行中ランのライブカウント表示（LAP-009 §3-5 / §4-D）。"use client"。
// 状態の正はサーバー（initial = Server Component が deriveSessionState で導出した値・再 open はサーバー再導出）。
// クライアントは startedAt(ISO) を起点に「クライアント時計の差分でカウントアップ」するだけの表示層であり、
// localStorage 等のクライアント永続化は使わない。導出ロジックは server と同じ deriveSessionState を再利用し、
// クライアント側でも startedAt + snapshot + Date() から現セグメント/expired を毎秒再計算する（表示用途）。

function formatClock(totalSec: number): string {
  const safe = totalSec > 0 ? totalSec : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseLabel(phase: SessionState["phase"]): string {
  switch (phase) {
    case "work":
      return "作業";
    case "break":
      return "休憩";
    case "expired":
      return "確定待ち";
  }
}

export function SessionTimer({
  initial,
  startedAt,
  snapshot,
}: {
  initial: SessionState;
  startedAt: string; // ISO 文字列（サーバーが渡す startedAt）。カウントの基準。
  snapshot: LapConfig[];
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

  if (state.expired) {
    return (
      <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
        <span className="font-semibold text-amber-800 dark:text-amber-300">
          確定期限に到達しました。
        </span>
        <span className="text-amber-700 dark:text-amber-400">
          記録への反映は後続の処理で行われます（集計反映は LAP-010 / 011）。
        </span>
      </div>
    );
  }

  const remaining = state.segmentTotalSec - state.segmentElapsedSec;

  return (
    <div className="flex flex-col items-center gap-3 rounded border border-gray-200 p-6 dark:border-gray-800">
      <span className="text-sm font-medium text-gray-500">
        {phaseLabel(state.phase)}（ラップ {state.lapIndex + 1}）
      </span>
      <span className="text-5xl font-bold tabular-nums tracking-tight">
        {formatClock(remaining)}
      </span>
      <span className="text-xs text-gray-400">
        現セグメント {formatClock(state.segmentElapsedSec)} /{" "}
        {formatClock(state.segmentTotalSec)} ・ 累計{" "}
        {formatClock(state.elapsedSec)}
      </span>
    </div>
  );
}
