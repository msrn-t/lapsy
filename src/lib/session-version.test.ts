import { describe, it, expect } from "vitest";
import { isSessionVersionValid } from "./session-version";

describe("isSessionVersionValid（失効バージョン照合）", () => {
  it("トークンと DB のバージョンが一致すれば有効", () => {
    expect(isSessionVersionValid(0, 0)).toBe(true);
    expect(isSessionVersionValid(3, 3)).toBe(true);
  });

  it("不一致なら無効（DB 側が increment された＝強制ログアウト）", () => {
    expect(isSessionVersionValid(0, 1)).toBe(false);
    expect(isSessionVersionValid(2, 5)).toBe(false);
  });

  it("DB にユーザーが存在しない（null/undefined）なら無効", () => {
    expect(isSessionVersionValid(0, null)).toBe(false);
    expect(isSessionVersionValid(0, undefined)).toBe(false);
  });

  it("トークンにバージョンが無い（旧トークン）なら無効", () => {
    expect(isSessionVersionValid(undefined, 0)).toBe(false);
    expect(isSessionVersionValid(null, 0)).toBe(false);
  });
});
