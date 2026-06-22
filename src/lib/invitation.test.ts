import { describe, it, expect } from "vitest";
import {
  INVITE_EXPIRY_HOURS,
  MIN_INVITE_PASSWORD_LENGTH,
  generateInviteToken,
  computeExpiry,
  evaluateInvitation,
  buildInviteUrl,
  validateInvitePassword,
  normalizeEmail,
  isValidEmail,
  summarizeInvitationRow,
} from "./invitation";

describe("generateInviteToken", () => {
  it("URL セーフな文字のみで構成される（base64url）", () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("256bit 由来の十分な長さを持つ（base64url の 32byte = 43 文字）", () => {
    const t = generateInviteToken();
    expect(t.length).toBe(43);
  });

  it("呼び出しごとに異なるトークンを生成する（ランダム性）", () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateInviteToken()));
    expect(set.size).toBe(1000);
  });
});

describe("computeExpiry", () => {
  it("now から INVITE_EXPIRY_HOURS(72h) 後を返す", () => {
    const now = new Date("2026-06-21T00:00:00.000Z");
    const exp = computeExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(
      INVITE_EXPIRY_HOURS * 60 * 60 * 1000,
    );
    expect(exp.toISOString()).toBe("2026-06-24T00:00:00.000Z");
  });

  it("元の now を破壊しない（新しい Date を返す）", () => {
    const now = new Date("2026-06-21T00:00:00.000Z");
    computeExpiry(now);
    expect(now.toISOString()).toBe("2026-06-21T00:00:00.000Z");
  });
});

describe("evaluateInvitation", () => {
  const now = new Date("2026-06-21T12:00:00.000Z");
  const future = new Date("2026-06-24T12:00:00.000Z");
  const past = new Date("2026-06-20T12:00:00.000Z");

  it("null は not_found", () => {
    expect(evaluateInvitation(null, now)).toEqual({
      valid: false,
      reason: "not_found",
    });
  });

  it("status=accepted は already_accepted", () => {
    expect(
      evaluateInvitation({ status: "accepted", expiresAt: future }, now),
    ).toEqual({ valid: false, reason: "already_accepted" });
  });

  it("status=expired は expired", () => {
    expect(
      evaluateInvitation({ status: "expired", expiresAt: future }, now),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("status=pending かつ expiresAt が未来なら valid", () => {
    expect(
      evaluateInvitation({ status: "pending", expiresAt: future }, now),
    ).toEqual({ valid: true });
  });

  it("status=pending かつ expiresAt が過去なら expired", () => {
    expect(
      evaluateInvitation({ status: "pending", expiresAt: past }, now),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("expiresAt === now（境界）は expired（<= now を期限切れとする）", () => {
    expect(
      evaluateInvitation({ status: "pending", expiresAt: now }, now),
    ).toEqual({ valid: false, reason: "expired" });
  });
});

describe("buildInviteUrl", () => {
  it("base + /invite/{token} を組み立てる", () => {
    expect(buildInviteUrl("http://localhost:3000", "abc")).toBe(
      "http://localhost:3000/invite/abc",
    );
  });

  it("base の末尾スラッシュを吸収する", () => {
    expect(buildInviteUrl("http://localhost:3000/", "abc")).toBe(
      "http://localhost:3000/invite/abc",
    );
    expect(buildInviteUrl("http://localhost:3000///", "abc")).toBe(
      "http://localhost:3000/invite/abc",
    );
  });

  it("token を URL エンコードする", () => {
    // base64url は URL セーフだが、念のためエンコード経路を検証する。
    expect(buildInviteUrl("https://app.example.com", "a b")).toBe(
      "https://app.example.com/invite/a%20b",
    );
  });
});

describe("validateInvitePassword", () => {
  it(`${MIN_INVITE_PASSWORD_LENGTH}文字未満は ok:false`, () => {
    const r = validateInvitePassword("short");
    expect(r.ok).toBe(false);
  });

  it(`${MIN_INVITE_PASSWORD_LENGTH}文字ちょうどは ok:true`, () => {
    expect(validateInvitePassword("a".repeat(MIN_INVITE_PASSWORD_LENGTH))).toEqual(
      { ok: true },
    );
  });

  it("十分な長さは ok:true", () => {
    expect(validateInvitePassword("correct horse battery")).toEqual({
      ok: true,
    });
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

describe("summarizeInvitationRow（招待履歴の表示整形・LAP-015 (d)）", () => {
  const now = new Date("2026-06-22T00:00:00.000Z");

  it("pending かつ期限内 → canResend=true / 「あとN時間」", () => {
    const inv = {
      status: "pending" as const,
      expiresAt: new Date("2026-06-24T10:00:00.000Z"), // +58h
    };
    expect(summarizeInvitationRow(inv, now)).toEqual({
      statusLabel: "pending",
      expiryLabel: "あと58時間",
      canResend: true,
    });
  });

  it("残り 1 時間未満は ceil で「あと1時間」になり再送可", () => {
    const inv = {
      status: "pending" as const,
      expiresAt: new Date("2026-06-22T00:30:00.000Z"), // +30min
    };
    const out = summarizeInvitationRow(inv, now);
    expect(out.expiryLabel).toBe("あと1時間");
    expect(out.canResend).toBe(true);
  });

  it("期限ちょうど（expiresAt == now）の pending は期限切れ扱い → 再送不可 / 「—」", () => {
    const inv = {
      status: "pending" as const,
      expiresAt: new Date("2026-06-22T00:00:00.000Z"),
    };
    expect(summarizeInvitationRow(inv, now)).toEqual({
      statusLabel: "pending",
      expiryLabel: "—",
      canResend: false,
    });
  });

  it("期限切れ pending（expiresAt < now）→ 再送不可 / 「—」", () => {
    const inv = {
      status: "pending" as const,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
    };
    expect(summarizeInvitationRow(inv, now)).toEqual({
      statusLabel: "pending",
      expiryLabel: "—",
      canResend: false,
    });
  });

  it("accepted → 再送不可 / 「—」（期限内でも）", () => {
    const inv = {
      status: "accepted" as const,
      expiresAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    expect(summarizeInvitationRow(inv, now)).toEqual({
      statusLabel: "accepted",
      expiryLabel: "—",
      canResend: false,
    });
  });

  it("expired → 再送不可 / 「—」", () => {
    const inv = {
      status: "expired" as const,
      expiresAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    expect(summarizeInvitationRow(inv, now)).toEqual({
      statusLabel: "expired",
      expiryLabel: "—",
      canResend: false,
    });
  });
});
