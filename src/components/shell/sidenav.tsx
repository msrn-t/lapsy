"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, type NavItem } from "@/lib/nav";
import { BrandLogo } from "./brand-logo";
import { NavIcon } from "./nav-icon";

// PC 左サイドナビ（LAP-014 §4 / WF 04-dashboard.html .sidenav）。
// usePathname でアクティブ判定するため client。表示するナビ項目（admin 出し分け済み）は
// server(layout) から props で受け取る（admin 判定は server で消費済み・client へ漏らさない）。
// width 196px・bg panel・右 1px border・上下 padding s3/s2・flex column。
// `hidden md:flex` で md 未満では非表示（モバイルは MobileMenu が担当）。

// WF .nav-item: gap10 / padding 9-10 / radius10 / font12。.active: bg-nav-active（LAP-018: Primary100）+ bold。
const navItemBase =
  "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-xs text-ink";
const navItemActive = "bg-nav-active font-bold";
const navItemIdle = "hover:bg-nav-active/60";
const navItemDisabled = "cursor-not-allowed text-ink-dim opacity-60";

export function Sidenav({
  primaryItems,
  secondaryItems,
  logoutSlot,
}: {
  /** admin 出し分け済みの主要ナビ（server で visibleNavItems 適用済み） */
  primaryItems: NavItem[];
  /** 下段ナビ（アカウント等。ログアウトは logoutSlot で別途渡す） */
  secondaryItems: NavItem[];
  /** ログアウト導線（form + server action の LogoutButton。server から渡す） */
  logoutSlot: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <nav className="hidden w-[196px] flex-none flex-col gap-1 border-r border-line bg-panel px-3 py-4 md:flex">
      <div className="mb-3">
        <BrandLogo />
      </div>

      {primaryItems.map((item) => (
        <NavLink key={item.key} item={item} pathname={pathname} />
      ))}

      {/* nav-fill（flex-1）で下段を底に寄せる */}
      <div className="flex-1" />
      <div className="mx-1 my-2 h-px bg-line" />

      {secondaryItems.map((item) => (
        <NavLink key={item.key} item={item} pathname={pathname} />
      ))}
      {logoutSlot}
    </nav>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(pathname, item);

  // 暫定非活性（アカウント等）はリンクを張らず span で dim 表示（LAP-014 §3 判断点6）。
  if (item.disabled) {
    return (
      <span
        aria-disabled="true"
        title="準備中"
        className={`${navItemBase} ${navItemDisabled}`}
      >
        <NavIcon navKey={item.key} />
        {item.label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`${navItemBase} ${active ? navItemActive : navItemIdle}`}
    >
      <NavIcon navKey={item.key} />
      {item.label}
      {item.adminOnly ? (
        <span className="ml-auto rounded-full border border-line-strong px-2 py-0.5 text-[10px] text-ink">
          Admin
        </span>
      ) : null}
    </Link>
  );
}
