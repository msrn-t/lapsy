// ポモドーロのプリセット（ラップ構成）の純ロジック（LAP-008 §3 / §4）。
// DB に非依存。入力検証・正規化（validatePresetInput）と、読込後の防御的パース
// （parsePresetConfig）をここに集約し、server action（page.tsx）はこれらを組み合わせる
// 薄い層にする。これにより DB に触れずに単体テストできる（SPEC §9）。
//
// JSONB の config はランタイム型保証が無いため、保存前は validatePresetInput で正規化済み
// LapConfig[] のみを書き、読込後は parsePresetConfig で narrowing して信頼しない（§3-3）。

/** プリセット名の最大文字数（SPEC 明示なし。LAP-006 MAX_TITLE_LENGTH=200 前例に合わせ固定・テスト担保）。 */
export const MAX_PRESET_NAME_LENGTH = 200;
/** ラップ数（config 要素数）の上限（暴走入力防止・SPEC 明示なし→固定）。 */
export const MAX_LAPS = 20;
/** ラップ作業時間の下限（SPEC §4/§7.3: 60 秒以上必須）。 */
export const MIN_WORK_SEC = 60;
/** 作業時間の上限（4 時間・§7.3 の 3 時間キャップに余裕）。 */
export const MAX_WORK_SEC = 14400;
/** 休憩時間の上限（4 時間・work と対称。0 は許容＝休憩なし）。 */
export const MAX_BREAK_SEC = 14400;

/**
 * ラップ1要素。Preset.config / StudySession.presetSnapshot（LAP-009）で共有する正規化済み構造。
 * StudySession.presetSnapshot（SPEC §7.1/§7.6）と同一構造であり、LAP-009 は preset.config を
 * そのまま presetSnapshot へコピー（スナップショット化）して再利用する。
 */
export type LapConfig = { workSec: number; breakSec: number };

/** フォーム由来の生入力（パース前）。workSec/breakSec は文字列または数値を許容する。 */
export type PresetInput = {
  name: string;
  laps: ReadonlyArray<{ workSec: string | number; breakSec: string | number }>;
};

export type PresetValidationReason =
  | "name_required"
  | "name_too_long"
  | "empty_config"
  | "too_many_laps"
  | "lap_work_too_short"
  | "lap_work_too_long"
  | "break_negative"
  | "break_too_long"
  | "invalid_number";

export type PresetValidationResult =
  | { ok: true; value: { name: string; config: LapConfig[] } }
  | { ok: false; reason: PresetValidationReason };

/**
 * フォーム由来の値（文字列または数値）を整数秒へパースする。
 * 非整数（NaN・小数・空文字・非数値文字列）は null を返す（→ invalid_number）。
 * 文字列は trim してからパースし、空文字は不正扱い。
 */
function parseIntegerSeconds(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // 小数や指数表記、末尾の非数字を弾くため Number で厳密にパースし整数性を確認する。
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * プリセット入力を検証・正規化する純関数（§3-2,3-3 / §4）。
 * フォーム由来の生入力を受け取り、成功時は DB にそのまま書ける { name, config } を、
 * 失敗時は理由コードを返す。失敗時は DB へは渡さない。
 *
 * 検証順（テストで固定）:
 *   1. name: trim 後 0 文字 → name_required、MAX_PRESET_NAME_LENGTH 超過 → name_too_long
 *   2. config: 空配列 → empty_config、MAX_LAPS 超過 → too_many_laps
 *   3. 各ラップを先頭から走査し最初の違反コードを返す:
 *      invalid_number（work/break いずれかが整数にパース不能）
 *      → lap_work_too_short（workSec < MIN_WORK_SEC）
 *      → lap_work_too_long（workSec > MAX_WORK_SEC）
 *      → break_negative（breakSec < 0）
 *      → break_too_long（breakSec > MAX_BREAK_SEC）
 */
export function validatePresetInput(
  input: PresetInput,
): PresetValidationResult {
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, reason: "name_required" };
  }
  if (name.length > MAX_PRESET_NAME_LENGTH) {
    return { ok: false, reason: "name_too_long" };
  }

  const laps = input.laps;
  if (laps.length === 0) {
    return { ok: false, reason: "empty_config" };
  }
  if (laps.length > MAX_LAPS) {
    return { ok: false, reason: "too_many_laps" };
  }

  const config: LapConfig[] = [];
  for (const lap of laps) {
    const workSec = parseIntegerSeconds(lap.workSec);
    const breakSec = parseIntegerSeconds(lap.breakSec);
    // 整数性（パース可否）を最優先で判定する。
    if (workSec === null || breakSec === null) {
      return { ok: false, reason: "invalid_number" };
    }
    if (workSec < MIN_WORK_SEC) {
      return { ok: false, reason: "lap_work_too_short" };
    }
    if (workSec > MAX_WORK_SEC) {
      return { ok: false, reason: "lap_work_too_long" };
    }
    if (breakSec < 0) {
      return { ok: false, reason: "break_negative" };
    }
    if (breakSec > MAX_BREAK_SEC) {
      return { ok: false, reason: "break_too_long" };
    }
    config.push({ workSec, breakSec });
  }

  return { ok: true, value: { name, config } };
}

/**
 * 読込後の防御的パーサ（§3-3）。DB の JsonValue（型保証なし）を信頼せず
 * LapConfig[] へ narrowing する。配列でない/要素が不正なら除外し、
 * 全体が不正なら空配列を返す。UI 表示・編集プリフィル用（保存には validatePresetInput を使う）。
 *
 * 各要素は workSec/breakSec がともに整数のときのみ採用する（範囲は強制しない＝表示用途のため、
 * 過去データや手動変更で範囲外でも壊れた表示にしないよう narrowing のみを行う）。
 */
export function parsePresetConfig(raw: unknown): LapConfig[] {
  if (!Array.isArray(raw)) return [];
  const result: LapConfig[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const { workSec, breakSec } = record;
    if (
      typeof workSec === "number" &&
      Number.isInteger(workSec) &&
      typeof breakSec === "number" &&
      Number.isInteger(breakSec)
    ) {
      result.push({ workSec, breakSec });
    }
  }
  return result;
}
