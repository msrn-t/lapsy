// アカウント設定の純ロジック（LAP-017 §3.3）。
// DB / bcrypt 非依存。表示名の正規化・検証をここに集約し、server action（page.tsx）は
// これを組み合わせる薄い層にする（preset.ts / password-reset.ts と同じ分離方針）。
// これにより送信や DB に触れずに単体テストできる（§9）。

/** 表示名の最大文字数（trim 後）。SPEC 未定義のため architect 裁量で 50 文字。 */
export const MAX_DISPLAY_NAME_LENGTH = 50;

export type DisplayNameResult =
  | { ok: true; value: string | null }
  | { ok: false; error: "name_too_long" };

/**
 * 表示名を正規化・検証する純関数（§3.3）。
 * - 前後を trim する。
 * - trim 後が空なら null（未設定。任意項目のため未設定に戻せる）。
 * - 上限（50 文字）超過は失敗（name_too_long）。
 */
export function validateDisplayName(raw: string): DisplayNameResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: "name_too_long" };
  }
  return { ok: true, value: trimmed };
}
