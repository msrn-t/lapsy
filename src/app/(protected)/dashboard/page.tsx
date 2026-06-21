import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-helpers";
import { LogoutButton } from "../logout-button";

// 保護ルート確認用の最小ダッシュボード（LAP-002 §4・後続 LAP-011 で本実装）。
// middleware（edge）は失効照合をしないため（§4-D の分割）、node 側でも
// getCurrentUser を評価し、失効済み（sessionVersion 不一致）なら /login へ送る二重防御。
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex flex-col gap-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
        <LogoutButton />
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        ログイン中: {user.email}
        {user.isAdmin ? "（管理者）" : ""}
      </p>
      <p className="text-sm text-gray-500">
        ※ このページは保護ルートの動作確認用です。集計の本実装は LAP-011 で行います。
      </p>
    </main>
  );
}
