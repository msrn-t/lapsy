// 共通 app shell のナビゲーション純ロジック（LAP-014 §4）。
// ナビ項目は純データ配列として定義し、アクティブ判定・admin 出し分け・
// パス→タイトル導出を純関数に分離する。これにより vitest（node 環境）で
// 単体テスト可能にし、コンポーネント（client）は usePathname と描画のみに専念できる。
//
// アイコンは描画側（components/shell）で key→アイコンの対応表を持つ。nav.ts は
// 純データ・純関数に保つ（テスト容易性 / サーバー・クライアント双方から参照可）。

export type NavMatchMode = "exact" | "prefix";

export type NavItem = {
  /** 安定キー（React key / アイコン対応表 / テスト用） */
  key: string;
  /** 表示ラベル（例: "ダッシュボード"） */
  label: string;
  /** 遷移先ルート。disabled の項目は遷移しない（リンクを張らない）。 */
  href: string;
  /** アクティブ判定方式（exact: 完全一致 / prefix: 前方一致） */
  matchMode: NavMatchMode;
  /** admin のみ表示（UI 出し分け。実認可は require* が担保する） */
  adminOnly?: boolean;
  /** 暫定非活性（LAP-017 までのアカウント）。リンクを張らず dim 表示。 */
  disabled?: boolean;
};

// 主要ナビ（サイドナビ上段 / モバイル下部タブ）。順序は WF 04-dashboard.html に準拠。
//  ダッシュボード /dashboard          matchMode:"exact"  ← /dashboard 接頭辞の罠を回避するため exact
//  タイマー       /dashboard/sessions matchMode:"prefix"
//  トピック       /dashboard/topics   matchMode:"prefix"
//  プリセット     /dashboard/presets  matchMode:"prefix"
//  管理(Admin)    /admin/users        matchMode:"prefix"（/admin/invite も含めるため /admin 前方一致）adminOnly
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    key: "dashboard",
    label: "ダッシュボード",
    href: "/dashboard",
    matchMode: "exact",
  },
  {
    key: "timer",
    label: "タイマー",
    href: "/dashboard/sessions",
    matchMode: "prefix",
  },
  {
    key: "topics",
    label: "トピック",
    href: "/dashboard/topics",
    matchMode: "prefix",
  },
  {
    key: "presets",
    label: "プリセット",
    href: "/dashboard/presets",
    matchMode: "prefix",
  },
  {
    key: "admin",
    label: "管理",
    // href は既定の管理画面。matchMode:"prefix" で /admin/invite もアクティブにする
    // ため、判定上は /admin を接頭辞とみなす（後述の isNavItemActive を参照）。
    href: "/admin/users",
    matchMode: "prefix",
    adminOnly: true,
  },
] as const;

// 下段（サイドナビ nav-sep の下 / モバイルメニュードロワー）。
// アカウントは LAP-017 で実ルートが作られるまで暫定非活性。
// ログアウトは form + server action（LogoutButton）で別途描画するため nav 配列には含めない。
export const SECONDARY_NAV: readonly NavItem[] = [
  {
    key: "account",
    label: "アカウント",
    // 暫定非活性。LAP-017 で disabled を外し href を実ルートへ差し替える。
    href: "#",
    matchMode: "exact",
    disabled: true,
  },
] as const;

// 管理ナビの prefix 判定で使う接頭辞（href=/admin/users だが /admin 配下全体をアクティブとみなす）。
const ADMIN_PREFIX = "/admin";

/**
 * 現在パスがナビ項目にマッチするか（アクティブ判定）。
 * - exact: 完全一致のみ（/dashboard が /dashboard/topics でアクティブにならない＝罠回避）
 * - prefix: 完全一致 または `href + "/"` で始まる（兄弟接頭辞の誤判定を防ぐ）
 *
 * 管理(admin)項目は href=/admin/users だが /admin 配下全体（/admin/invite 等）を
 * アクティブとみなすため、判定上の接頭辞を /admin に丸める。
 */
export function isNavItemActive(currentPath: string, item: NavItem): boolean {
  if (item.disabled) return false;

  const base = item.key === "admin" ? ADMIN_PREFIX : item.href;

  if (item.matchMode === "exact") {
    return currentPath === base;
  }
  // prefix: 完全一致 または `base + "/"` で始まる。
  // `startsWith(base + "/")` を使うことで、例えば /dashboard が /dashboardX に
  // 誤って前方一致するのを防ぐ。
  return currentPath === base || currentPath.startsWith(base + "/");
}

/**
 * admin 出し分け後の表示項目を返す。
 * adminOnly な項目は isAdmin=true のときのみ含める（UI 上の出し分け）。
 * 実認可は各ページの require* が担保するため、ここは表示制御のみ。
 */
export function visibleNavItems(
  items: readonly NavItem[],
  isAdmin: boolean,
): NavItem[] {
  return items.filter((item) => (item.adminOnly ? isAdmin : true));
}

// パス→ページタイトルの導出テーブル（最長前方一致）。
// ナビ非掲載の詳細ルート（/dashboard/topics/[id]/edit・/admin/invite 等）は
// 最寄りの親セクションのタイトルに丸める。WF の per-page 微細タイトルは
// 後続チケット（LAP-015/017）で各 page が必要に応じて上書きする余地を残す。
const TITLE_TABLE: ReadonlyArray<{ prefix: string; title: string }> = [
  { prefix: "/dashboard/sessions", title: "タイマー" },
  { prefix: "/dashboard/topics", title: "トピック" },
  { prefix: "/dashboard/presets", title: "プリセット" },
  { prefix: "/dashboard", title: "ダッシュボード" },
  { prefix: "/admin/invite", title: "招待" },
  { prefix: "/admin/users", title: "ユーザー管理" },
  { prefix: "/admin", title: "管理" },
];

const DEFAULT_TITLE = "Lapsy";

/**
 * 現在パスからページタイトルを導出する（最長前方一致）。
 * - 完全一致 または `prefix + "/"` で始まるエントリのうち、最長の prefix を採用する。
 * - 該当が無ければ既定タイトル（"Lapsy"）を返す。
 */
export function pageTitleForPath(currentPath: string): string {
  let best: { length: number; title: string } | null = null;
  for (const entry of TITLE_TABLE) {
    const matches =
      currentPath === entry.prefix ||
      currentPath.startsWith(entry.prefix + "/");
    if (matches && (!best || entry.prefix.length > best.length)) {
      best = { length: entry.prefix.length, title: entry.title };
    }
  }
  return best?.title ?? DEFAULT_TITLE;
}
