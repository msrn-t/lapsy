import { describe, it, expect } from "vitest";
import { validateDisplayName, MAX_DISPLAY_NAME_LENGTH } from "./account";

// validateDisplayName の純ロジック単体テスト（LAP-017 §9 / vitest・node 環境）。
// 受け入れ条件: 空→null / 通常 trim / 50 文字 ok / 51 文字 name_too_long を網羅する。

describe("validateDisplayName", () => {
  it("空文字は null（未設定）", () => {
    expect(validateDisplayName("")).toEqual({ ok: true, value: null });
  });

  it("空白のみは trim 後に空 → null", () => {
    expect(validateDisplayName("   ")).toEqual({ ok: true, value: null });
  });

  it("通常の値は trim して返す", () => {
    expect(validateDisplayName("山田 太郎")).toEqual({
      ok: true,
      value: "山田 太郎",
    });
    expect(validateDisplayName("  前後空白あり  ")).toEqual({
      ok: true,
      value: "前後空白あり",
    });
  });

  it("境界: 50 文字は許容", () => {
    const name = "a".repeat(MAX_DISPLAY_NAME_LENGTH);
    expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
  });

  it("境界: 51 文字は name_too_long", () => {
    const name = "a".repeat(MAX_DISPLAY_NAME_LENGTH + 1);
    expect(validateDisplayName(name)).toEqual({
      ok: false,
      error: "name_too_long",
    });
  });

  it("上限判定は trim 後の長さで行う（前後空白は数えない）", () => {
    const name = "a".repeat(MAX_DISPLAY_NAME_LENGTH);
    // 前後に空白を付けても trim 後 50 文字なら ok。
    expect(validateDisplayName(`  ${name}  `)).toEqual({
      ok: true,
      value: name,
    });
  });
});
