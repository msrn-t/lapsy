import { randomBytes } from "node:crypto";

// 招待フローの純ロジック（LAP-003 §3-C / §4）。
// DB・メールに非依存。トークン生成・期限計算・有効性判定・パスワード検証を
// ここに集約し、server action（page.tsx）はこれらを組み合わせる薄い層にする。
// これにより送信や DB に触れずに単体テストできる（§8）。

/** 招待トークンの有効期限（時間単位）。発行から72時間（SPEC §5 / §3-C）。 */
export const INVITE_EXPIRY_HOURS = 72;

/** 受諾時パスワードの最小文字数。 */
export const MIN_INVITE_PASSWORD_LENGTH = 8;

/**
 * crypto.randomBytes による URL セーフな招待トークンを生成する（256bit）。
 * base64url エンコードのため [A-Za-z0-9_-] のみを含み、URL にそのまま埋め込める。
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 発行時刻から有効期限（now + INVITE_EXPIRY_HOURS）を算出する。 */
export function computeExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);
}

export type InvitationCheck =
  | { valid: true }
  | { valid: false; reason: "not_found" | "already_accepted" | "expired" };

/**
 * 招待レコード（or null）と現在時刻から有効/無効を判定する純関数（§3-C）。
 * - 不在            → not_found
 * - status=accepted → already_accepted（使用済み）
 * - status=expired  → expired（期限切れ確定）
 * - status=pending かつ expiresAt <= now → expired（期限切れ）
 * - status=pending かつ expiresAt >  now → valid
 */
export function evaluateInvitation(
  inv: { status: "pending" | "accepted" | "expired"; expiresAt: Date } | null,
  now: Date,
): InvitationCheck {
  if (!inv) return { valid: false, reason: "not_found" };
  if (inv.status === "accepted") {
    return { valid: false, reason: "already_accepted" };
  }
  if (inv.status === "expired") return { valid: false, reason: "expired" };
  // status === "pending"
  if (inv.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}

/**
 * 招待リンク URL を組み立てる。base URL は呼び出し側が環境変数から渡す。
 * 末尾スラッシュの有無を吸収する。
 */
export function buildInviteUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/invite/${encodeURIComponent(token)}`;
}

/** 受諾時のパスワード最小要件（長さ）を検証する純関数（§3-E）。 */
export function validateInvitePassword(
  pw: string,
): { ok: true } | { ok: false; error: string } {
  if (pw.length < MIN_INVITE_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `パスワードは${MIN_INVITE_PASSWORD_LENGTH}文字以上で設定してください。`,
    };
  }
  return { ok: true };
}

// ── 招待履歴の表示整形（LAP-015 (d)・WF 09 招待履歴テーブル）──
// 招待レコードの状態・有効期限・再送可否を表示用に整形する純関数。DB 非依存・now 注入でテスト可能。

export type InvitationRowView = {
  statusLabel: "pending" | "accepted" | "expired";
  expiryLabel: string; // "あと58時間" / "—"
  canResend: boolean; // pending かつ期限内のみ
};

/**
 * 招待履歴の 1 行を表示用ビューへ整形する純関数（§4-Admin-invite / LAP-015 (d)）。
 * - statusLabel: status をそのまま採る（pending/accepted/expired）。
 * - expiryLabel: pending かつ期限内 → 「あと N 時間」（N = ceil((expiresAt-now)/1h)・最小 1）。
 *                それ以外（accepted/expired/期限切れ pending）→ "—"。
 * - canResend: 再送可否は evaluateInvitation の valid 判定に揃える（pending かつ期限内のみ true）。
 *   これにより「期限切れ pending」は accepted/expired と同じく再送導線を出さない。
 */
export function summarizeInvitationRow(
  inv: { status: "pending" | "accepted" | "expired"; expiresAt: Date },
  now: Date,
): InvitationRowView {
  const valid = evaluateInvitation(inv, now).valid;
  let expiryLabel = "—";
  if (valid) {
    const remainingMs = inv.expiresAt.getTime() - now.getTime();
    const hours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
    expiryLabel = `あと${hours}時間`;
  }
  return {
    statusLabel: inv.status,
    expiryLabel,
    canResend: valid,
  };
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
