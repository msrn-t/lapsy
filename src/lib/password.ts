import bcrypt from "bcryptjs";

// bcryptjs によるパスワードハッシュ（LAP-002 §3 / §4）。
// pure JS 実装でネイティブビルド不要。cost=10 は低頻度ログイン向けに十分。
const SALT_ROUNDS = 10;

/** 平文パスワードを bcrypt ハッシュへ変換する。 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** 平文パスワードとハッシュを照合する。一致すれば true。 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// 表示専用のパスワード強度判定（LAP-016 §3.2 / U1）。
// クライアントの強度メーター描画にのみ使う「助言 UI」であり、
// サーバーの合格条件（8 文字・validateInvitePassword/validateNewPassword）とは独立。
// weak でも 8 文字を満たせばサーバーは受理する（ゲートにしない）。
export type PasswordStrength = "weak" | "medium" | "strong";

/**
 * パスワード文字列から weak/medium/strong を算出する純関数。
 * 長さスコア（短い=0 / 8 以上=1 / 12 以上=2）と
 * 文字種多様性（小文字・大文字・数字・記号の 4 種で 0..4）の合算（0..6）を
 * 閾値で 3 段階に分類する。DB/bcrypt 非依存。
 */
export function scorePasswordStrength(password: string): PasswordStrength {
  // 空文字は weak（メーターは塗り 0 相当でもよいが分類は weak）。
  if (password.length === 0) return "weak";

  // 文字種の多様性（4 種: 小文字 / 大文字 / 数字 / 記号）。
  let variety = 0;
  if (/[a-z]/.test(password)) variety++;
  if (/[A-Z]/.test(password)) variety++;
  if (/[0-9]/.test(password)) variety++;
  if (/[^A-Za-z0-9]/.test(password)) variety++;

  // 長さスコア（短い=0, 8 以上=1, 12 以上=2）。
  const lengthScore =
    password.length >= 12 ? 2 : password.length >= 8 ? 1 : 0;

  const total = variety + lengthScore; // 0..6

  // 閾値: 弱 / 中 / 強。
  if (total <= 2) return "weak";
  if (total <= 4) return "medium";
  return "strong";
}

/** 2 つのパスワード文字列が一致するか（確認フィールド用・純関数）。 */
export function passwordsMatch(a: string, b: string): boolean {
  return a === b;
}
