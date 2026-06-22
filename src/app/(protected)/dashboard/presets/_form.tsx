import { MAX_LAPS } from "@/lib/preset";

// プリセットのラップ入力 FormData 収集ヘルパ（LAP-008 §4）。
// 入力 UI は _lap-rows.tsx（client component）に分離する。本ファイルは server action から
// 呼ぶため "use client" を付けない（client モジュールの関数は server 側で実行できないため）。

/** 分（文字列）を秒（文字列）へ変換する。整数分のみ変換し、非整数は生値のまま返して検証側で弾く。 */
function minutesToSeconds(min: string): string {
  const n = Number(min);
  if (!Number.isInteger(n)) return min;
  return String(n * 60);
}

/**
 * FormData からラップ入力を validatePresetInput の laps 形式（秒）へ組み立てる。
 * 入力は分単位（lap-{i}-workMin / lap-{i}-breakMin）で受け取り、秒へ変換する。
 * 作業時間（workMin）が空欄の行はラップとして扱わない（未使用ラップ行のスキップ）。
 * 休憩が空欄なら 0 分（休憩なし）として扱う。パース不能な値は純関数側で検証する。
 */
export function collectLaps(
  formData: FormData,
): ReadonlyArray<{ workSec: string; breakSec: string }> {
  const laps: { workSec: string; breakSec: string }[] = [];
  for (let i = 0; i < MAX_LAPS; i++) {
    const workRaw = formData.get(`lap-${i}-workMin`);
    const breakRaw = formData.get(`lap-${i}-breakMin`);
    const workMin = typeof workRaw === "string" ? workRaw.trim() : "";
    const breakMin = typeof breakRaw === "string" ? breakRaw.trim() : "";
    if (workMin.length === 0) continue; // 未使用ラップ行をスキップ。
    laps.push({
      workSec: minutesToSeconds(workMin),
      breakSec: minutesToSeconds(breakMin.length === 0 ? "0" : breakMin),
    });
  }
  return laps;
}
