import { redirect } from "next/navigation";
import { auth } from "@/auth";

// データ分離の核（LAP-002 §4 / SPEC §7.5）。
// クライアント入力の id は信頼せず、必ず認証セッション由来の userId を
// 後続クエリのフィルタに使う。LAP-003〜011 の全クエリがこれを経由する。

export type CurrentUser = {
  id: string;
  email: string;
  isAdmin: boolean;
};

/**
 * 認証セッションから現在のユーザーを取得する。未認証なら null。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin ?? false,
  };
}

/**
 * 認証済みユーザーの userId を返す。未認証なら /login へリダイレクトする。
 * クエリの userId フィルタにはこの戻り値のみを使うこと。
 */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user.id;
}
