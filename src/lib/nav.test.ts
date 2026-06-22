import { describe, it, expect } from "vitest";
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  isNavItemActive,
  visibleNavItems,
  pageTitleForPath,
  type NavItem,
} from "./nav";

// nav.ts の純ロジック単体テスト（LAP-014 §9 / vitest・node 環境）。
// 受け入れ条件: /dashboard 接頭辞の罠・admin 出し分け・タイトル最長前方一致を網羅する。

const byKey = (key: string): NavItem => {
  const item = [...PRIMARY_NAV, ...SECONDARY_NAV].find((i) => i.key === key);
  if (!item) throw new Error(`nav item not found: ${key}`);
  return item;
};

describe("ナビ定義の整合", () => {
  it("PRIMARY_NAV は WF の順序（ダッシュボード/タイマー/トピック/プリセット/管理）", () => {
    expect(PRIMARY_NAV.map((i) => i.key)).toEqual([
      "dashboard",
      "timer",
      "topics",
      "presets",
      "admin",
    ]);
  });

  it("ダッシュボードのみ exact、他の主要ナビは prefix", () => {
    expect(byKey("dashboard").matchMode).toBe("exact");
    for (const key of ["timer", "topics", "presets", "admin"]) {
      expect(byKey(key).matchMode).toBe("prefix");
    }
  });

  it("管理のみ adminOnly", () => {
    expect(byKey("admin").adminOnly).toBe(true);
    for (const key of ["dashboard", "timer", "topics", "presets"]) {
      expect(byKey(key).adminOnly).toBeFalsy();
    }
  });

  it("アカウントは暫定非活性（disabled）", () => {
    expect(byKey("account").disabled).toBe(true);
  });

  it("key は一意", () => {
    const keys = [...PRIMARY_NAV, ...SECONDARY_NAV].map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isNavItemActive", () => {
  it("ダッシュボード(exact)は /dashboard でのみアクティブ", () => {
    expect(isNavItemActive("/dashboard", byKey("dashboard"))).toBe(true);
  });

  it("/dashboard 接頭辞の罠: 子ルートでダッシュボードはアクティブにならない", () => {
    // exact なので /dashboard/topics 上ではダッシュボードは非アクティブ。
    expect(isNavItemActive("/dashboard/topics", byKey("dashboard"))).toBe(false);
    expect(isNavItemActive("/dashboard/sessions", byKey("dashboard"))).toBe(
      false,
    );
    expect(isNavItemActive("/dashboard/presets", byKey("dashboard"))).toBe(
      false,
    );
  });

  it("prefix: トピックは /dashboard/topics と配下でアクティブ", () => {
    expect(isNavItemActive("/dashboard/topics", byKey("topics"))).toBe(true);
    expect(
      isNavItemActive("/dashboard/topics/abc/edit", byKey("topics")),
    ).toBe(true);
    expect(isNavItemActive("/dashboard/topics/archived", byKey("topics"))).toBe(
      true,
    );
  });

  it("prefix: トピックは /dashboard では非アクティブ（兄弟接頭辞の誤判定なし）", () => {
    expect(isNavItemActive("/dashboard", byKey("topics"))).toBe(false);
    // /dashboard/topicsX のような擬似接頭辞も非アクティブ（startsWith(base + "/")）。
    expect(isNavItemActive("/dashboard/topicsX", byKey("topics"))).toBe(false);
  });

  it("タイマー / プリセットの prefix 判定", () => {
    expect(isNavItemActive("/dashboard/sessions", byKey("timer"))).toBe(true);
    expect(isNavItemActive("/dashboard/presets/xyz", byKey("presets"))).toBe(
      true,
    );
    expect(isNavItemActive("/dashboard/presets", byKey("timer"))).toBe(false);
  });

  it("管理は /admin 配下全体でアクティブ（/admin/users・/admin/invite）", () => {
    expect(isNavItemActive("/admin/users", byKey("admin"))).toBe(true);
    expect(isNavItemActive("/admin/invite", byKey("admin"))).toBe(true);
    expect(isNavItemActive("/admin", byKey("admin"))).toBe(true);
  });

  it("管理は保護外パスでは非アクティブ", () => {
    expect(isNavItemActive("/dashboard", byKey("admin"))).toBe(false);
    expect(isNavItemActive("/administration", byKey("admin"))).toBe(false);
  });

  it("公開パスではどの主要ナビもアクティブにならない（アクティブ表示の境界）", () => {
    // root ラッパ撤去で公開ページ（/・/login）にも shell ロジックが評価され得ないが、
    // 仮に評価されてもアクティブ項目が出ないことを保証する（誤点灯の回帰防止）。
    for (const path of ["/", "/login", "/invite/abc", "/password-reset"]) {
      for (const item of PRIMARY_NAV) {
        expect(isNavItemActive(path, item)).toBe(false);
      }
    }
  });

  it("disabled な項目は常に非アクティブ", () => {
    expect(isNavItemActive("#", byKey("account"))).toBe(false);
    expect(isNavItemActive("/dashboard/account", byKey("account"))).toBe(false);
  });
});

describe("visibleNavItems", () => {
  it("isAdmin=false なら adminOnly を除外", () => {
    const visible = visibleNavItems(PRIMARY_NAV, false);
    expect(visible.map((i) => i.key)).toEqual([
      "dashboard",
      "timer",
      "topics",
      "presets",
    ]);
  });

  it("isAdmin=true なら adminOnly を含む", () => {
    const visible = visibleNavItems(PRIMARY_NAV, true);
    expect(visible.map((i) => i.key)).toContain("admin");
    expect(visible).toHaveLength(PRIMARY_NAV.length);
  });

  it("adminOnly が無い配列は isAdmin に関わらず全件", () => {
    expect(visibleNavItems(SECONDARY_NAV, false)).toHaveLength(
      SECONDARY_NAV.length,
    );
    expect(visibleNavItems(SECONDARY_NAV, true)).toHaveLength(
      SECONDARY_NAV.length,
    );
  });
});

describe("pageTitleForPath", () => {
  it("各セクションの基本タイトル", () => {
    expect(pageTitleForPath("/dashboard")).toBe("ダッシュボード");
    expect(pageTitleForPath("/dashboard/sessions")).toBe("タイマー");
    expect(pageTitleForPath("/dashboard/topics")).toBe("トピック");
    expect(pageTitleForPath("/dashboard/presets")).toBe("プリセット");
  });

  it("最長前方一致: 子ルートは親セクションのタイトルに丸める", () => {
    expect(pageTitleForPath("/dashboard/topics/abc/edit")).toBe("トピック");
    expect(pageTitleForPath("/dashboard/topics/archived")).toBe("トピック");
    expect(pageTitleForPath("/dashboard/presets/xyz")).toBe("プリセット");
  });

  it("最長前方一致: /dashboard/sessions は /dashboard より優先", () => {
    // /dashboard も /dashboard/sessions も前方一致するが、より長い prefix を採用。
    expect(pageTitleForPath("/dashboard/sessions/run")).toBe("タイマー");
  });

  it("admin 系のタイトル", () => {
    expect(pageTitleForPath("/admin/users")).toBe("ユーザー管理");
    expect(pageTitleForPath("/admin/invite")).toBe("招待");
    // /admin 直下や未定義の admin 配下は最寄りの "管理" に丸める。
    expect(pageTitleForPath("/admin")).toBe("管理");
    expect(pageTitleForPath("/admin/other")).toBe("管理");
  });

  it("最長前方一致: admin サブルートは親セクションのタイトルに丸める", () => {
    // /admin/users/123 は /admin（管理）と /admin/users（ユーザー管理）の双方に前方一致するが、
    // より長い /admin/users を採用する（最長前方一致）。
    expect(pageTitleForPath("/admin/users/123")).toBe("ユーザー管理");
    expect(pageTitleForPath("/admin/invite/token")).toBe("招待");
  });

  it("未掲載パスは既定タイトル", () => {
    expect(pageTitleForPath("/unknown")).toBe("Lapsy");
    expect(pageTitleForPath("/")).toBe("Lapsy");
  });
});
