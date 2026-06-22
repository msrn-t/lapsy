import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMailer } from "@/lib/mailer";
import { BrandIcon } from "@/components/brand-icon";
import {
  RESET_REQUEST_ACK_MESSAGE,
  buildResetUrl,
  computeResetExpiry,
  generateResetToken,
  hashResetToken,
  isValidEmail,
  normalizeEmail,
} from "@/lib/password-reset";

// 公開リセット要求ページ（LAP-005 §3-C / §3-E）。
// authorized は /dashboard・/admin のみ保護するため /password-reset は公開のまま
// （未認証アクセス可＝リセットはログイン前機能）。
// 列挙対策: メールアドレスの存在有無に関わらず常に同一 ack（RESET_REQUEST_ACK_MESSAGE）を返す。
// 存在する場合のみトークン発行（既存未使用を一括無効化）＋メール送信を行う。
// リセット URL の base は AUTH_URL を流用する（招待と同じ・§4）。

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

export default async function PasswordResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  async function requestReset(formData: FormData) {
    "use server";

    const email = normalizeEmail(String(formData.get("email") ?? ""));

    // 形式不正でも存在を露呈しないよう、原則は一様 ack に寄せる（§3-C）。
    if (isValidEmail(email)) {
      const user = await prisma.user.findUnique({ where: { email } });

      // 存在する場合のみ発行＋送信。存在しなくても応答は同一（列挙対策）。
      if (user) {
        const now = new Date();
        const raw = generateResetToken();
        const hashed = hashResetToken(raw);

        await prisma.$transaction(async (tx) => {
          // §3-D: 既存未使用トークンを一括 used 化し、有効リンクを最新 1 本に限定する。
          await tx.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: now },
          });
          // §3-A: DB の token 列には sha256 ハッシュを保存する（生トークンは URL のみ）。
          await tx.passwordResetToken.create({
            data: {
              token: hashed,
              userId: user.id,
              expiresAt: computeResetExpiry(now),
            },
          });
        });

        // コミット後・存在時のみ送信。URL には生トークン raw を載せる。
        const r = await getMailer().sendPasswordReset({
          to: email,
          resetUrl: buildResetUrl(baseUrl(), raw),
        });
        if (!r.ok) {
          // §3-G: 送信失敗は内部ログのみ。ユーザー応答は変えない（存在露呈防止）。
          // eslint-disable-next-line no-console
          console.error(
            `[password-reset] メール送信に失敗しました: ${r.error}`,
          );
        }
      }
    }

    // 存在有無に関わらず同一 ack へ redirect（§3-C）。
    redirect("/password-reset?sent=1");
  }

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center">
      <div className="w-full max-w-[380px] rounded-card border border-line bg-card px-6 py-8">
        {/* ブランド（WF 補完） */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandIcon size={52} />
          <span className="font-[family-name:var(--font-fredoka)] text-[24px] font-semibold leading-none text-ink">
            Lapsy
          </span>
          <span className="text-[11px] text-ink-dim">
            ラップで積み上げる、資格学習タイマー
          </span>
        </div>

        <h1 className="text-center font-[family-name:var(--font-fredoka)] text-[17px] font-medium text-ink">
          パスワードをリセット
        </h1>

        <p className="mb-6 mt-1.5 text-center text-xs leading-relaxed text-ink-dim">
          登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。
        </p>

        {sent ? (
          <p
            role="status"
            className="mb-6 rounded-ctl border border-dashed border-line-2 bg-[#EDEDED] px-3 py-2.5 text-xs leading-relaxed text-ink"
          >
            {RESET_REQUEST_ACK_MESSAGE}
          </p>
        ) : null}

        <form action={requestReset}>
          <div className="mb-6">
            <label
              htmlFor="email"
              className="mb-2 block text-xs font-medium text-ink"
            >
              メールアドレス
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="min-h-[44px] w-full rounded-ctl border border-line-2 bg-fill px-3 text-sm text-ink placeholder:text-placeholder focus:border-line-strong focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="flex min-h-[46px] w-full items-center justify-center rounded-ctl bg-btn font-[family-name:var(--font-fredoka)] text-sm font-medium text-btn-ink transition hover:opacity-90"
          >
            再設定リンクを送信
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-dim">
          <a
            href="/login"
            className="text-xs text-ink underline underline-offset-2"
          >
            ログイン画面に戻る
          </a>
        </p>
      </div>
    </main>
  );
}
