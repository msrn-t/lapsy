"use client";

import { useState } from "react";
import { MAX_LAPS, type LapConfig } from "@/lib/preset";

// プリセットのラップ入力 UI（LAP-008 §4）。作成（page.tsx）と編集（[id]/edit/page.tsx）で共有する。
// 入力は「分」で行い、server action 側（collectLaps）で秒へ変換して検証・保存する。
// route の page モジュールはデフォルトエクスポートのみが望ましいため、共有部品は本ファイルに分離する。

/** 新規作成時に最初から表示するラップ行数（#1〜#3）。以降は「＋」で追加する。 */
const DEFAULT_VISIBLE_LAPS = 3;

/**
 * ラップ入力行をレンダリングする。
 * - 新規（initial 無し）: DEFAULT_VISIBLE_LAPS 行を表示。
 * - 編集（initial 有り）: 既存ラップ数だけ表示（秒→分へ変換してプリフィル）。
 * 「＋」で MAX_LAPS まで行を追加、「－」で 1 行まで削除できる。
 */
export function LapRows({ initial }: { initial?: LapConfig[] }) {
  const initialCount =
    initial && initial.length > 0
      ? Math.min(initial.length, MAX_LAPS)
      : DEFAULT_VISIBLE_LAPS;
  const [count, setCount] = useState(initialCount);

  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: count }, (_, i) => {
        const lap = initial?.[i];
        return (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-10 text-xs text-ink-dim">#{i + 1}</span>
            <label className="flex items-center gap-1">
              <span className="text-xs text-ink-dim">作業(分)</span>
              <input
                type="number"
                name={`lap-${i}-workMin`}
                min={1}
                step={1}
                defaultValue={lap ? String(Math.round(lap.workSec / 60)) : "1"}
                className="w-24 rounded-ctl border border-line-2 bg-fill px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-xs text-ink-dim">休憩(分)</span>
              <input
                type="number"
                name={`lap-${i}-breakMin`}
                min={0}
                step={1}
                defaultValue={lap ? String(Math.round(lap.breakSec / 60)) : "0"}
                className="w-24 rounded-ctl border border-line-2 bg-fill px-2 py-1 text-sm"
              />
            </label>
          </div>
        );
      })}
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCount((c) => Math.min(c + 1, MAX_LAPS))}
          disabled={count >= MAX_LAPS}
          aria-label="ラップを追加"
          className="inline-flex h-7 w-7 items-center justify-center rounded-ctl border border-line-2 text-sm text-ink disabled:opacity-40"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => setCount((c) => Math.max(c - 1, 1))}
          disabled={count <= 1}
          aria-label="ラップを削除"
          className="inline-flex h-7 w-7 items-center justify-center rounded-ctl border border-line-2 text-sm text-ink disabled:opacity-40"
        >
          －
        </button>
      </div>
    </div>
  );
}
