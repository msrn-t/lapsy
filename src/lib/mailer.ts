// メール送信の抽象化（LAP-003 §3-D）。
// 招待のビジネスロジック（重複/期限判定・トークン生成）を送信から完全分離する。
// 送信は throw でなく結果オブジェクトを返す（Resend の {data,error} 判別ユニオンに合わせる）。
//
// 重要: トップレベルで `new Resend()` しない（遅延初期化）。これにより
// RESEND_API_KEY 未設定でも import 時に落ちず、build / tsc / test が緑になる。

export type MailerResult = { ok: true } | { ok: false; error: string };

export interface Mailer {
  sendInvitation(args: {
    to: string;
    inviteUrl: string;
  }): Promise<MailerResult>;
}

const SUBJECT = "Lapsy への招待";

function invitationText(inviteUrl: string): string {
  return [
    "Lapsy へ招待されました。",
    "",
    "以下のリンクからパスワードを設定して登録を完了してください（リンクの有効期限は72時間です）:",
    inviteUrl,
    "",
    "心当たりがない場合はこのメールを破棄してください。",
  ].join("\n");
}

function invitationHtml(inviteUrl: string): string {
  return [
    "<p>Lapsy へ招待されました。</p>",
    "<p>以下のリンクからパスワードを設定して登録を完了してください（リンクの有効期限は72時間です）。</p>",
    `<p><a href="${inviteUrl}">${inviteUrl}</a></p>`,
    "<p>心当たりがない場合はこのメールを破棄してください。</p>",
  ].join("");
}

/**
 * Resend 経由でメールを送信する Mailer。
 * `new Resend` は send 呼び出し時に遅延生成する（モジュールトップに副作用を持たない）。
 */
export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string) {}

  async sendInvitation(args: {
    to: string;
    inviteUrl: string;
  }): Promise<MailerResult> {
    // 動的 import + 呼び出し時インスタンス化で、キー無し環境の import を汚さない。
    const { Resend } = await import("resend");
    const resend = new Resend(this.apiKey);

    const { data, error } = await resend.emails.send({
      from: process.env.MAIL_FROM ?? "onboarding@resend.dev",
      to: args.to,
      subject: SUBJECT,
      text: invitationText(args.inviteUrl),
      html: invitationHtml(args.inviteUrl),
    });

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: "メール送信に失敗しました（不明なエラー）。" };
    }
    return { ok: true };
  }
}

/**
 * 送信を行わず、開発用に inviteUrl をログ出力して成功を返す Mailer。
 * RESEND_API_KEY 未設定時のフォールバック（§3-D）。これにより招待作成は動作し、
 * 送信のみスキップされる。
 */
export class NoopMailer implements Mailer {
  async sendInvitation(args: {
    to: string;
    inviteUrl: string;
  }): Promise<MailerResult> {
    // eslint-disable-next-line no-console
    console.info(
      `[NoopMailer] RESEND_API_KEY 未設定のため送信をスキップしました。to=${args.to} inviteUrl=${args.inviteUrl}`,
    );
    return { ok: true };
  }
}

/**
 * RESEND_API_KEY の有無で Mailer を選択する（遅延初期化）。
 * 未設定 → NoopMailer（送信スキップ・ログ出力）、設定済み → ResendMailer。
 */
export function getMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  if (!key) return new NoopMailer();
  return new ResendMailer(key);
}
