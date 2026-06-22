"use client";

import { useRef, useState } from "react";
import { MAX_LAPS, type LapConfig } from "@/lib/preset";

// プリセットのラップ入力 UI（LAP-008 §4）。作成（page.tsx）と編集（[id]/edit/page.tsx）で共有する。
// 入力は「分」で行い、server action 側（collectLaps）で秒へ変換して検証・保存する。
// 数値入力は w-28(112px) で 100px 以上に保つ。KeePassXC 拡張は「幅<100px の数値入力が
// 複数並ぶ」とセグメント型 TOTP（ワンタイムコード）と誤検出してアイコンを差し込むため、
// 幅で候補条件を外して誤検出を防ぐ（autocomplete=off だけでは抑止できない）。
// 追加/削除 UI はワイヤーフレーム（docs/wireframes/08-presets.html）を正とする:
//   - 各行末に削除ボタン（行ごとに削除）
//   - 行の下に「＋ ラップを追加」ボタン（末尾に1行追加）
// route の page モジュールはデフォルトエクスポートのみが望ましいため、共有部品は本ファイルに分離する。

/** 新規作成時に最初から表示するラップ行数（#1〜#3）。以降は「＋ ラップを追加」で増やす。 */
const DEFAULT_VISIBLE_LAPS = 3;

type Row = { id: number; workMin: string; breakMin: string };

/**
 * ラップ入力行をレンダリングする。
 * - 新規（initial 無し）: DEFAULT_VISIBLE_LAPS 行を既定値（作業1分/休憩0分）で表示。
 * - 編集（initial 有り）: 既存ラップを秒→分へ変換してプリフィル。
 * 行は React key（安定 id）で管理し、削除しても残りの入力値を保持する。
 * input の name は描画位置（0 始まり連番）で振り直すため、collectLaps は常に先頭から詰めて読める。
 */
export function LapRows({ initial }: { initial?: LapConfig[] }) {
  const idRef = useRef(0);
  const makeRow = (workMin: string, breakMin: string): Row => ({
    id: idRef.current++,
    workMin,
    breakMin,
  });

  const [rows, setRows] = useState<Row[]>(() =>
    initial && initial.length > 0
      ? initial.map((lap) =>
          makeRow(
            String(Math.round(lap.workSec / 60)),
            String(Math.round(lap.breakSec / 60)),
          ),
        )
      : Array.from({ length: DEFAULT_VISIBLE_LAPS }, () => makeRow("25", "5")),
  );

  const addRow = () =>
    setRows((rs) => (rs.length >= MAX_LAPS ? rs : [...rs, makeRow("25", "5")]));
  const removeRow = (id: number) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));

  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= MAX_LAPS}
          className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-line-2 px-3 text-xs text-ink disabled:opacity-40"
        >
          ＋ ラップを追加
        </button>
      </div>
      {rows.map((row, i) => (
        <div key={row.id} className="flex items-center gap-2 text-sm">
          <span className="w-10 text-xs text-ink-dim">#{i + 1}</span>
          <label className="flex items-center gap-1">
            <span className="text-xs text-ink-dim">作業</span>
            <input
              type="number"
              name={`lap-${i}-workMin`}
              min={1}
              step={1}
              defaultValue={row.workMin}
              autoComplete="off"
              className="w-28 rounded-ctl border border-line-2 bg-fill px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-xs text-ink-dim">休憩</span>
            <input
              type="number"
              name={`lap-${i}-breakMin`}
              min={0}
              step={1}
              defaultValue={row.breakMin}
              autoComplete="off"
              className="w-28 rounded-ctl border border-line-2 bg-fill px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => removeRow(row.id)}
            disabled={rows.length <= 1}
            aria-label={`#${i + 1} を削除`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-error text-xs text-error disabled:opacity-40"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
