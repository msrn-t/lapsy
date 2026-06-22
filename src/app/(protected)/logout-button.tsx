import { signOut } from "@/auth";
import { NavIcon } from "@/components/shell/nav-icon";

// ログアウト導線（LAP-002 §4-B / LAP-014 §3 判断点7）。
// server action で signOut し /login へ。GET リンク（<a>）ではなく form + server action で
// 副作用（ログアウト）を起こす。app shell のサイドナビ下部・モバイルメニューで再利用する。

// nav-item 風の見た目（WF .nav-item）。サイドナビ / モバイルメニューの他項目と揃える。
const navItemClass =
  "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-xs text-ink hover:bg-nav-active";

export function LogoutButton() {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <form action={logout}>
      <button type="submit" className={navItemClass}>
        <NavIcon navKey="logout" />
        ログアウト
      </button>
    </form>
  );
}
