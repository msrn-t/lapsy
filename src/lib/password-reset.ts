import { randomBytes, createHash } from "node:crypto";

// パスワードリセットの純ロジック（LAP-005 §3 / §4）。
// DB・メールに非依存。トークン生成・sha256 ハッシュ化・期限計算・有効性判定・
// パスワード検証・URL 組立・一様応答文言をここに集約し、server action（page.tsx）は
// これらを組み合わせる薄い層にする（invitation.ts と同じ分離方針）。
// これにより送信や DB に触れずに単体テストできる（§9）。
//
// 役割分担（設計の不変条件・§3-A）:
//   パスワード保存   = bcrypt（src/lib/password.ts・低速・ソルト付き）
//   リセットトークン = sha256（高速・高エントロピー乱数 + 1h 失効 + 単一使用で十分）

/** リセットトークンの有効期限（分単位）。発行から60分=1時間（SPEC §5 / §3-B）。 */
export const RESET_TOKEN_TTL_MINUTES = 60;

/** 新パスワードの最小文字数。 */
export const MIN_RESET_PASSWORD_LENGTH = 8;

/**
 * ユーザー存在を露呈しない一様応答メッセージ（§3-C）。
 * リセット要求はメールアドレスの存在有無に関わらず常にこの文言を返す。
 */
export const RESET_REQUEST_ACK_MESSAGE =
  "入力されたメールアドレスが登録されている場合、パスワード再設定用のリンクを送信しました。";

/**
 * 無効/期限切れ/使用済みを区別しない一様エラーメッセージ（§3-C）。
 * 理由を出し分けると有効トークンの推測やトークン総当たりのフィードバックになるため一様化する。
 */
export const RESET_INVALID_LINK_MESSAGE =
  "このリンクは無効か、有効期限が切れています。お手数ですが再度リセットを要求してください。";

/**
 * crypto.randomBytes による URL セーフな生リセットトークンを生成する（256bit）。
 * base64url エンコードのため [A-Za-z0-9_-] のみを含み、URL にそのまま埋め込める。
 * この生トークンはメールのリセット URL にのみ載せる。DB には保存しない（§3-A）。
 */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 生トークンを sha256 hex に変換する純関数（§3-A）。
 * DB の token 列にはこの値（64 文字 hex）を保存・lookup する。
 * 発行・GET・POST すべてが本関数を経由し、保存と lookup のエンコード一致を保証する。
 */
export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** 発行時刻から有効期限（now + RESET_TOKEN_TTL_MINUTES）を算出する。 */
export function computeResetExpiry(now: Date): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}

export type ResetTokenCheck =
  | { valid: true }
  | { valid: false; reason: "not_found" | "used" | "expired" };

/**
 * トークンレコード（or null）と現在時刻から有効/無効を判定する純関数（§3-B）。
 * 表示は一様化するが内部の理由種別は保持する（監査・ログ用途）。
 * - 不在                     → not_found
 * - usedAt != null（使用済み）→ used
 * - expiresAt <= now         → expired（境界 expiresAt === now は期限切れ）
 * - usedAt == null かつ expiresAt > now → valid
 */
export function evaluatePasswordResetToken(
  rec: { usedAt: Date | null; expiresAt: Date } | null,
  now: Date,
): ResetTokenCheck {
  if (!rec) return { valid: false, reason: "not_found" };
  if (rec.usedAt !== null) return { valid: false, reason: "used" };
  if (rec.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}

/** 新パスワードの最小要件（長さ）を検証する純関数（§3-F）。 */
export function validateNewPassword(
  pw: string,
): { ok: true } | { ok: false; error: string } {
  if (pw.length < MIN_RESET_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `パスワードは${MIN_RESET_PASSWORD_LENGTH}文字以上で設定してください。`,
    };
  }
  return { ok: true };
}

/**
 * リセットリンク URL を組み立てる。base URL は呼び出し側が環境変数から渡す。
 * 末尾スラッシュの有無を吸収する。生トークン（raw）を載せる（DB はハッシュ・§3-A）。
 */
export function buildResetUrl(baseUrl: string, rawToken: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/password-reset/${encodeURIComponent(rawToken)}`;
}

/** メールアドレスを正規化する（trim + 小文字化）。判定の入口で必ず通す。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 最低限のメール形式チェック（純関数・厳密 RFC ではなく実用範囲）。 */
export function isValidEmail(email: string): boolean {
  // 1 個の @ を挟んで前後に空白なしの文字列、ドメインにドットを要求する。
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
