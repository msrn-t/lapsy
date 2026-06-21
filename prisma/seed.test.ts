import { describe, it, expect } from "vitest";
import { readAdminCredentials } from "./seed";

describe("readAdminCredentials（初期管理者 seed の env 読み取り）", () => {
  it("ADMIN_EMAIL / ADMIN_PASSWORD が揃っていれば読み取れる", () => {
    const result = readAdminCredentials({
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "pw",
    });
    expect(result).toEqual({ email: "admin@example.com", password: "pw" });
  });

  it("email の前後空白はトリムされる", () => {
    const result = readAdminCredentials({
      ADMIN_EMAIL: "  admin@example.com  ",
      ADMIN_PASSWORD: "pw",
    });
    expect(result.email).toBe("admin@example.com");
  });

  it("ADMIN_EMAIL 未設定ならエラー終了（ハードコード防止）", () => {
    expect(() =>
      readAdminCredentials({ ADMIN_PASSWORD: "pw" }),
    ).toThrow(/ADMIN_EMAIL/);
  });

  it("ADMIN_EMAIL が空文字ならエラー", () => {
    expect(() =>
      readAdminCredentials({
        ADMIN_EMAIL: "   ",
        ADMIN_PASSWORD: "pw",
      }),
    ).toThrow(/ADMIN_EMAIL/);
  });

  it("ADMIN_PASSWORD 未設定ならエラー終了", () => {
    expect(() =>
      readAdminCredentials({
        ADMIN_EMAIL: "admin@example.com",
      }),
    ).toThrow(/ADMIN_PASSWORD/);
  });
});
