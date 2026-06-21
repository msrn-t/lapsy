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
