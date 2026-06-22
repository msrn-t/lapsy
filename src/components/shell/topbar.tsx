"use client";

import { usePathname } from "next/navigation";
import { pageTitleForPath } from "@/lib/nav";

// トップバー（LAP-014 §4 / WF 04-dashboard.html .topbar）。
// height 50px・下 1px border・横 padding s4。ページタイトルは usePathname →
// pageTitleForPath で導出するため client。email は server から props で受け取る
// （client で auth を読まない）。`hidden md:flex` で PC のみ表示（モバイルは MobileMenu）。

export function Topbar({ email }: { email: string }) {
  const pathname = usePathname();
  const title = pageTitleForPath(pathname);

  return (
    <header className="hidden h-[50px] flex-none items-center gap-3 border-b border-line px-6 md:flex">
      <h2 className="m-0 font-[family-name:var(--font-fredoka)] text-base font-medium text-ink">
        {title}
      </h2>
      <span className="flex-1" />
      {/* user-chip（WF .user-chip）: email + avatar 円。WF は表示名だが、既存
          getCurrentUser は email のみ露出のため email 表示が確実（設計の決定）。 */}
      <span className="flex items-center gap-2 text-xs text-ink-dim">
        <span className="max-w-[200px] truncate" title={email}>
          {email}
        </span>
        <span
          aria-hidden="true"
          className="h-[26px] w-[26px] flex-none rounded-full border border-line bg-[#DDD]"
        />
      </span>
    </header>
  );
}
