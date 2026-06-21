// 失効バージョン照合の純ロジック（LAP-002 §4-D）。
// jwt callback から切り出してユニットテスト可能にする。
//
// JWT に焼き込まれた sessionVersion と DB の最新 sessionVersion を比較し、
// トークンを引き続き有効とみなしてよいかを判定する。
// 不一致（招待取消・強制ログアウト等で DB 側が increment された）なら無効。
// DB にユーザーが存在しない場合も無効とする。

/**
 * トークンの sessionVersion が DB の最新版と一致するか判定する純関数。
 * @param tokenVersion JWT に焼き込まれた sessionVersion（未設定時 undefined）
 * @param dbVersion DB の最新 sessionVersion（ユーザー不在時 null/undefined）
 * @returns 有効なら true、無効化すべきなら false
 */
export function isSessionVersionValid(
  tokenVersion: number | undefined | null,
  dbVersion: number | undefined | null,
): boolean {
  if (typeof tokenVersion !== "number") return false;
  if (typeof dbVersion !== "number") return false;
  return tokenVersion === dbVersion;
}
