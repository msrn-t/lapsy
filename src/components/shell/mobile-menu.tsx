"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, pageTitleForPath, type NavItem } from "@/lib/nav";
import { NavIcon } from "./nav-icon";

// モバイル app shell の chrome（LAP-014 §4 / WF 04-dashboard.html .mshell）。
// `md:hidden` で md 未満のみ表示。content（children）は layout が単一スロットで描画し、
// MobileMenu は chrome（上部バー / 下部タブ / メニュードロワー）のみを担う
// （children を二重描画しないため・server component の二重実行を避ける）。
//  - 上部バー（.mtop）: 左にハンバーガー + 中央にページタイトル
//  - 下部タブ（.bottomtab）: 主要4（ダッシュ/タイマー/トピック/プリセット）+ 「メニュー」
//  - 「メニュー」タップで useState ドロワー展開（管理[admin のみ]/アカウント/ログアウト）
// usePathname 変化でドロワーを閉じる（ナビ遷移時に自動で畳む）。
// admin 出し分け済みナビは server(layout) から props で受け取る。

// 下部タブは主要ナビ先頭4件（ダッシュ/タイマー/トピック/プリセット）を採用し、
// 管理・アカウント・ログアウトは「メニュー」ドロワーへ集約する（WF モバイル指針）。
const BOTTOM_TAB_KEYS = ["dashboard", "timer", "topics", "presets"];

export function MobileTopbar() {
  const pathname = usePathname();
  const title = pageTitleForPath(pathname);
  return (
    <header className="relative flex h-[46px] flex-none items-center justify-center border-b border-line md:hidden">
      <span className="font-[family-name:var(--font-fredoka)] text-sm font-medium text-ink">
        {title}
      </span>
    </header>
  );
}

export function MobileNav({
  primaryItems,
  secondaryItems,
  logoutSlot,
}: {
  primaryItems: NavItem[];
  secondaryItems: NavItem[];
  logoutSlot: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // パス変化でドロワーを閉じる（遷移後に開きっぱなしを防ぐ）。
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const tabs = BOTTOM_TAB_KEYS.map((key) =>
    primaryItems.find((i) => i.key === key),
  ).filter((i): i is NavItem => Boolean(i));

  // 「メニュー」に集約: 主要ナビのうち下部タブに載らないもの（管理 等）+ 下段（アカウント）。
  const drawerItems = [
    ...primaryItems.filter((i) => !BOTTOM_TAB_KEYS.includes(i.key)),
    ...secondaryItems,
  ];

  return (
    <div className="md:hidden">
      {/* ドロワー（管理/アカウント/ログアウト）。open のときオーバーレイ表示。 */}
      {open ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div className="absolute bottom-[56px] left-0 right-0 flex flex-col gap-1 border-t border-line bg-panel p-3 shadow-lg">
            {drawerItems.map((item) =>
              item.disabled ? (
                <span
                  key={item.key}
                  aria-disabled="true"
                  title="準備中"
                  className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-xs text-ink-dim opacity-60"
                >
                  <NavIcon navKey={item.key} />
                  {item.label}
                </span>
              ) : (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={
                    isNavItemActive(pathname, item) ? "page" : undefined
                  }
                  className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-xs text-ink hover:bg-nav-active"
                >
                  <NavIcon navKey={item.key} />
                  {item.label}
                  {item.adminOnly ? (
                    <span className="ml-auto rounded-full border border-line-strong px-2 py-0.5 text-[10px] text-ink">
                      Admin
                    </span>
                  ) : null}
                </Link>
              ),
            )}
            {logoutSlot}
          </div>
        </div>
      ) : null}

      {/* 下部タブ（fixed で画面下部に固定。layout が pb で被りを回避） */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-line bg-panel">
        {tabs.map((item) => {
          const active = isNavItemActive(pathname, item);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 px-0 pb-2 pt-1.5 text-[9.5px] ${
                active ? "font-bold text-ink" : "text-ink-dim"
              }`}
            >
              <NavIcon navKey={item.key} />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          aria-label="メニュー"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`flex flex-1 flex-col items-center gap-1 px-0 pb-2 pt-1.5 text-[9.5px] ${
            open ? "font-bold text-ink" : "text-ink-dim"
          }`}
        >
          <NavIcon navKey="menu" />
          メニュー
        </button>
      </nav>
    </div>
  );
}
