import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  RESET_TOKEN_TTL_MINUTES,
  MIN_RESET_PASSWORD_LENGTH,
  RESET_REQUEST_ACK_MESSAGE,
  RESET_INVALID_LINK_MESSAGE,
  generateResetToken,
  hashResetToken,
  computeResetExpiry,
  evaluatePasswordResetToken,
  validateNewPassword,
  buildResetUrl,
  normalizeEmail,
  isValidEmail,
} from "./password-reset";

describe("generateResetToken", () => {
  it("URL セーフな文字のみで構成される（base64url）", () => {
    const t = generateResetToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("256bit 由来の十分な長さを持つ（base64url の 32byte = 43 文字）", () => {
    const t = generateResetToken();
    expect(t.length).toBe(43);
  });

  it("呼び出しごとに異なるトークンを生成する（ランダム性）", () => {
    const set = new Set(
      Array.from({ length: 1000 }, () => generateResetToken()),
    );
    expect(set.size).toBe(1000);
  });
});

describe("hashResetToken", () => {
  it("既知入力を既知の sha256 hex に変換する（保存・lookup の固定検証）", () => {
    // "test" の sha256 hex（外部実装と独立した既知の固定値）。
    expect(hashResetToken("test")).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  it("64 文字の hex 文字列を返す（sha256）", () => {
    const h = hashResetToken(generateResetToken());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じ入力には常に同じハッシュを返す（決定的・lookup 整合）", () => {
    const raw = generateResetToken();
    expect(hashResetToken(raw)).toBe(hashResetToken(raw));
  });

  it("異なる入力には異なるハッシュを返す", () => {
    expect(hashResetToken("a")).not.toBe(hashResetToken("b"));
  });

  it("Node 標準 crypto と同一の値を返す（実装の二重確認）", () => {
    const raw = generateResetToken();
    const expected = createHash("sha256").update(raw).digest("hex");
    expect(hashResetToken(raw)).toBe(expected);
  });

  it("生トークンとハッシュは異なる（生トークンは保存されない）", () => {
    const raw = generateResetToken();
    expect(hashResetToken(raw)).not.toBe(raw);
  });
});

describe("computeResetExpiry", () => {
  it("now から RESET_TOKEN_TTL_MINUTES(60分=1時間) 後を返す", () => {
    const now = new Date("2026-06-22T00:00:00.000Z");
    const exp = computeResetExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(
      RESET_TOKEN_TTL_MINUTES * 60 * 1000,
    );
    expect(exp.toISOString()).toBe("2026-06-22T01:00:00.000Z");
  });

  it("元の now を破壊しない（新しい Date を返す）", () => {
    const now = new Date("2026-06-22T00:00:00.000Z");
    computeResetExpiry(now);
    expect(now.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });
});

describe("evaluatePasswordResetToken", () => {
  const now = new Date("2026-06-22T12:00:00.000Z");
  const future = new Date("2026-06-22T13:00:00.000Z");
  const past = new Date("2026-06-22T11:00:00.000Z");

  it("null は not_found", () => {
    expect(evaluatePasswordResetToken(null, now)).toEqual({
      valid: false,
      reason: "not_found",
    });
  });

  it("usedAt が設定済みは used（使用済み・期限内でも）", () => {
    expect(
      evaluatePasswordResetToken({ usedAt: past, expiresAt: future }, now),
    ).toEqual({ valid: false, reason: "used" });
  });

  it("usedAt=null かつ expiresAt が未来なら valid", () => {
    expect(
      evaluatePasswordResetToken({ usedAt: null, expiresAt: future }, now),
    ).toEqual({ valid: true });
  });

  it("usedAt=null かつ expiresAt が過去なら expired", () => {
    expect(
      evaluatePasswordResetToken({ usedAt: null, expiresAt: past }, now),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("expiresAt === now（境界）は expired（<= now を期限切れとする）", () => {
    expect(
      evaluatePasswordResetToken({ usedAt: null, expiresAt: now }, now),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("使用済みは期限切れより優先して used を返す（理由判定の順序）", () => {
    // usedAt あり かつ expiresAt も過去 → used が先（再利用検知を優先）。
    expect(
      evaluatePasswordResetToken({ usedAt: past, expiresAt: past }, now),
    ).toEqual({ valid: false, reason: "used" });
  });
});

describe("validateNewPassword", () => {
  it(`${MIN_RESET_PASSWORD_LENGTH}文字未満は ok:false`, () => {
    const r = validateNewPassword("short");
    expect(r.ok).toBe(false);
  });

  it(`${MIN_RESET_PASSWORD_LENGTH}文字ちょうどは ok:true`, () => {
    expect(
      validateNewPassword("a".repeat(MIN_RESET_PASSWORD_LENGTH)),
    ).toEqual({ ok: true });
  });

  it("十分な長さは ok:true", () => {
    expect(validateNewPassword("correct horse battery")).toEqual({
      ok: true,
    });
  });
});

describe("buildResetUrl", () => {
  it("base + /password-reset/{token} を組み立てる", () => {
    expect(buildResetUrl("http://localhost:3000", "abc")).toBe(
      "http://localhost:3000/password-reset/abc",
    );
  });

  it("base の末尾スラッシュを吸収する", () => {
    expect(buildResetUrl("http://localhost:3000/", "abc")).toBe(
      "http://localhost:3000/password-reset/abc",
    );
    expect(buildResetUrl("http://localhost:3000///", "abc")).toBe(
      "http://localhost:3000/password-reset/abc",
    );
  });

  it("token を URL エンコードする", () => {
    // base64url は URL セーフだが、念のためエンコード経路を検証する。
    expect(buildResetUrl("https://app.example.com", "a b")).toBe(
      "https://app.example.com/password-reset/a%20b",
    );
  });
});

describe("normalizeEmail", () => {
  it("trim + 小文字化する", () => {
    expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });
});

describe("isValidEmail", () => {
  it("妥当なメールを true", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it.each(["", "no-at", "a@b", "a@@b.com", "a b@example.com", "@example.com"])(
    "不正なメール %s を false",
    (bad) => {
      expect(isValidEmail(bad)).toBe(false);
    },
  );
});

describe("一様応答メッセージ（列挙対策・§3-C）", () => {
  it("RESET_REQUEST_ACK_MESSAGE は存在有無を露呈しない条件付き文言である", () => {
    // 「登録されている場合」という条件付き表現で存在/非存在を判別できないことを保証。
    expect(RESET_REQUEST_ACK_MESSAGE).toContain("登録されている場合");
  });

  it("RESET_INVALID_LINK_MESSAGE は理由を出し分けない一様文言である", () => {
    // 「無効か、有効期限が切れています」と理由を曖昧化していることを保証。
    expect(RESET_INVALID_LINK_MESSAGE).toContain("無効");
    expect(RESET_INVALID_LINK_MESSAGE).toContain("有効期限");
  });
});
