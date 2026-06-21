import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getMailer, NoopMailer, ResendMailer } from "./mailer";

// 実 Resend API は叩かない。getMailer のキー有無分岐と、各 Mailer の戻り値契約を検証する。

describe("getMailer", () => {
  const orig = process.env.RESEND_API_KEY;

  afterEach(() => {
    if (orig === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = orig;
  });

  it("RESEND_API_KEY 未設定なら NoopMailer を返す", () => {
    delete process.env.RESEND_API_KEY;
    expect(getMailer()).toBeInstanceOf(NoopMailer);
  });

  it("RESEND_API_KEY 設定済みなら ResendMailer を返す", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    expect(getMailer()).toBeInstanceOf(ResendMailer);
  });
});

describe("NoopMailer", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("送信せず {ok:true} を返し、inviteUrl をログ出力する", async () => {
    const r = await new NoopMailer().sendInvitation({
      to: "user@example.com",
      inviteUrl: "http://localhost:3000/invite/tok",
    });
    expect(r).toEqual({ ok: true });
    expect(infoSpy).toHaveBeenCalledOnce();
    const logged = String(infoSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("http://localhost:3000/invite/tok");
  });

  it("sendPasswordReset も送信せず {ok:true} を返し、resetUrl をログ出力する", async () => {
    const r = await new NoopMailer().sendPasswordReset({
      to: "user@example.com",
      resetUrl: "http://localhost:3000/password-reset/tok",
    });
    expect(r).toEqual({ ok: true });
    expect(infoSpy).toHaveBeenCalledOnce();
    const logged = String(infoSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("http://localhost:3000/password-reset/tok");
  });
});

describe("ResendMailer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("resend.emails.send が data を返したら {ok:true}", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "email_1" }, error: null });
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send };
      },
    }));

    // doMock 後に動的 import するモジュールへ反映させるため再評価する。
    const { ResendMailer: Mailer } = await import("./mailer");
    const r = await new Mailer("re_test").sendInvitation({
      to: "user@example.com",
      inviteUrl: "http://localhost:3000/invite/tok",
    });
    expect(r).toEqual({ ok: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it("resend.emails.send が error を返したら {ok:false,error}", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "bad key" } });
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send };
      },
    }));

    const { ResendMailer: Mailer } = await import("./mailer");
    const r = await new Mailer("re_test").sendInvitation({
      to: "user@example.com",
      inviteUrl: "http://localhost:3000/invite/tok",
    });
    expect(r).toEqual({ ok: false, error: "bad key" });
  });

  it("sendPasswordReset: send が data を返したら {ok:true}", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ data: { id: "email_1" }, error: null });
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send };
      },
    }));

    const { ResendMailer: Mailer } = await import("./mailer");
    const r = await new Mailer("re_test").sendPasswordReset({
      to: "user@example.com",
      resetUrl: "http://localhost:3000/password-reset/tok",
    });
    expect(r).toEqual({ ok: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it("sendPasswordReset: send が error を返したら {ok:false,error}", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "bad key" } });
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send };
      },
    }));

    const { ResendMailer: Mailer } = await import("./mailer");
    const r = await new Mailer("re_test").sendPasswordReset({
      to: "user@example.com",
      resetUrl: "http://localhost:3000/password-reset/tok",
    });
    expect(r).toEqual({ ok: false, error: "bad key" });
  });
});
