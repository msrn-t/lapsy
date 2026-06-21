import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing (bcryptjs)", () => {
  it("ハッシュは平文と異なり bcrypt 形式である", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(hash).not.toBe("s3cret-pass");
    // bcrypt のハッシュは $2a$ / $2b$ で始まる
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it("正しいパスワードで verify が true を返す（ラウンドトリップ）", async () => {
    const hash = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(
      true,
    );
  });

  it("誤ったパスワードで verify が false を返す", async () => {
    const hash = await hashPassword("correct horse battery");
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("同じ平文でもソルトにより異なるハッシュになる", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    // どちらも検証は通る
    await expect(verifyPassword("same", a)).resolves.toBe(true);
    await expect(verifyPassword("same", b)).resolves.toBe(true);
  });

  it("不正な形式のハッシュでも throw せず false を返す（authorize の堅牢性）", async () => {
    // DB の passwordHash が破損/非 bcrypt 形式でも authorize が 500 にならず
    // 認証失敗（null）に倒れることを保証する。
    await expect(verifyPassword("any", "not-a-bcrypt-hash")).resolves.toBe(
      false,
    );
  });

  it("空文字ハッシュでも throw せず false を返す", async () => {
    await expect(verifyPassword("any", "")).resolves.toBe(false);
  });
});
