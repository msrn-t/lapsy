import { MAX_LAPS, type LapConfig } from "@/lib/preset";

// プリセットのラップ入力 UI と FormData 収集ヘルパ（LAP-008 §4）。
// 作成（page.tsx）と編集（[id]/edit/page.tsx）で共有する。
// route の page モジュールはデフォルトエクスポートのみが望ましいため、共有部品は本ファイルに分離する。

/**
 * ラップ入力行を MAX_LAPS 行レンダリングする。
 * initial が与えられた行は workSec/breakSec をプリフィルする（編集時）。
 * 作業時間（workSec）が空欄の行は server action 側（collectLaps）で無視される。
 */
export function LapRows({ initial }: { initial?: LapConfig[] }) {
  const rows = Array.from({ length: MAX_LAPS }, (_, i) => initial?.[i]);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((lap, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-10 text-xs text-ink-dim">#{i + 1}</span>
          <label className="flex items-center gap-1">
            <span className="text-xs text-ink-dim">作業(秒)</span>
            <input
              type="number"
              name={`lap-${i}-workSec`}
              min={0}
              step={1}
              defaultValue={lap ? String(lap.workSec) : ""}
              className="w-24 rounded-ctl border border-line-2 bg-fill px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-xs text-ink-dim">休憩(秒)</span>
            <input
              type="number"
              name={`lap-${i}-breakSec`}
              min={0}
              step={1}
              defaultValue={lap ? String(lap.breakSec) : ""}
              className="w-24 rounded-ctl border border-line-2 bg-fill px-2 py-1 text-sm"
            />
          </label>
        </div>
      ))}
    </div>
  );
}

/**
 * FormData からラップ入力を validatePresetInput の laps 形式へ組み立てる。
 * 作業時間（workSec）が空欄の行はラップとして扱わない（未使用ラップ行のスキップ）。
 * 休憩が空欄なら "0"（休憩なし）として扱う。パース不能な値は純関数側で検証する。
 */
export function collectLaps(
  formData: FormData,
): ReadonlyArray<{ workSec: string; breakSec: string }> {
  const laps: { workSec: string; breakSec: string }[] = [];
  for (let i = 0; i < MAX_LAPS; i++) {
    const workRaw = formData.get(`lap-${i}-workSec`);
    const breakRaw = formData.get(`lap-${i}-breakSec`);
    const workSec = typeof workRaw === "string" ? workRaw.trim() : "";
    const breakSec = typeof breakRaw === "string" ? breakRaw.trim() : "";
    if (workSec.length === 0) continue; // 未使用ラップ行をスキップ。
    laps.push({ workSec, breakSec: breakSec.length === 0 ? "0" : breakSec });
  }
  return laps;
}
