import { signOut } from "@/auth";

// ログアウト導線（LAP-002 §4-B）。server action で signOut し /login へ。
export function LogoutButton() {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        ログアウト
      </button>
    </form>
  );
}
