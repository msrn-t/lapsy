import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  scorePasswordStrength,
  passwordsMatch,
} from "./password";

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

describe("scorePasswordStrength (表示専用・LAP-016 §3.2)", () => {
  it("空文字は weak", () => {
    expect(scorePasswordStrength("")).toBe("weak");
  });

  it("8 文字未満（小文字のみ）は weak（length 0 + variety 1 = 1）", () => {
    expect(scorePasswordStrength("abcdefg")).toBe("weak"); // 7 文字
  });

  it("ちょうど 8 文字・単一文字種は weak（length 1 + variety 1 = 2）", () => {
    expect(scorePasswordStrength("abcdefgh")).toBe("weak");
  });

  it("8 文字・2 種（小文字+数字）は medium（length 1 + variety 2 = 3）", () => {
    expect(scorePasswordStrength("abcdefg1")).toBe("medium");
  });

  it("8 文字・3 種（小文字+大文字+数字）は medium（length 1 + variety 3 = 4）", () => {
    expect(scorePasswordStrength("Abcdefg1")).toBe("medium");
  });

  it("9 文字・4 種（記号含む）は strong（length 1 + variety 4 = 5）", () => {
    expect(scorePasswordStrength("Abcdefg1!")).toBe("strong");
  });

  it("12 文字・単一文字種は medium（length 2 + variety 1 = 3）", () => {
    expect(scorePasswordStrength("abcdefghijkl")).toBe("medium");
  });

  it("12 文字・3 種は strong（length 2 + variety 3 = 5）", () => {
    expect(scorePasswordStrength("Abcdefghijk1")).toBe("strong");
  });

  it("16 文字・4 種は strong（length 2 + variety 4 = 6・上限）", () => {
    expect(scorePasswordStrength("Abcdefghijk1!@#$")).toBe("strong");
  });

  it("短く複雑（7 文字・4 種）は medium（length 0 + variety 4 = 4）", () => {
    expect(scorePasswordStrength("Ab1!cd")).toBe("medium"); // 6 文字
  });

  it("空白を含む記号も記号として variety に数える", () => {
    // 11 文字・小文字+空白(記号扱い) = variety 2, length 1 → 3 = medium
    expect(scorePasswordStrength("abc def ghi")).toBe("medium");
  });
});

describe("passwordsMatch (確認フィールド用・純関数)", () => {
  it("同一文字列は true", () => {
    expect(passwordsMatch("hunter2-pass", "hunter2-pass")).toBe(true);
  });

  it("異なる文字列は false", () => {
    expect(passwordsMatch("hunter2-pass", "hunter2-Pass")).toBe(false);
  });

  it("両方空文字は true（一致扱い・出し分けはクライアント側で制御）", () => {
    expect(passwordsMatch("", "")).toBe(true);
  });

  it("片方のみ空文字は false", () => {
    expect(passwordsMatch("abcdefgh", "")).toBe(false);
  });
});
