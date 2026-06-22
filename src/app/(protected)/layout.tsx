import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-helpers";
import { PRIMARY_NAV, SECONDARY_NAV, visibleNavItems } from "@/lib/nav";
import { Sidenav } from "@/components/shell/sidenav";
import { Topbar } from "@/components/shell/topbar";
import { MobileTopbar, MobileNav } from "@/components/shell/mobile-menu";
import { LogoutButton } from "./logout-button";

// 共通 app shell（LAP-014 §4 / WF 04-dashboard.html）。
// server component。getCurrentUser() でユーザー（email）と isAdmin を取得し、
// admin 出し分け（visibleNavItems）を server 側で適用してから client へ絞り込み済み配列を渡す
// （admin 判定を client に漏らさない）。
//
// 認証・データ分離は変更しない（受け入れ条件）。実認可は各 page の require* と edge が担保する。
// ここでの getCurrentUser→redirect は UI 上 email/admin を安全に扱うための防御に留める。
//
// レイアウト方針（Tailwind モバイルファースト）:
//  - 既定（< md）: MobileTopbar（上部バー）+ content + MobileNav（下部タブ + ドロワー）
//  - md 以上: Sidenav（左固定）+ Topbar + content
// content（children）は単一スロットで描画し、chrome のみ md で出し分ける
// （children を二重描画せず server component の二重実行を避ける）。
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // admin 出し分けを server で適用（client には絞り込み済み配列のみ渡す）。
  const primaryItems = visibleNavItems(PRIMARY_NAV, user.isAdmin);
  const secondaryItems = visibleNavItems(SECONDARY_NAV, user.isAdmin);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidenav
        primaryItems={primaryItems}
        secondaryItems={secondaryItems}
        logoutSlot={<LogoutButton />}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={user.email} />
        <MobileTopbar />

        {/* content（WF .content: padding s4 / overflow auto / flex1）。
            モバイルは下部タブ（fixed・約56px）に被らないよう pb を確保。 */}
        <main className="flex-1 overflow-auto p-4 pb-20 md:p-6 md:pb-6">
          {children}
        </main>
      </div>

      <MobileNav
        primaryItems={primaryItems}
        secondaryItems={secondaryItems}
        logoutSlot={<LogoutButton />}
      />
    </div>
  );
}
