import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMailer } from "@/lib/mailer";
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
    <main className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        パスワードの再設定
      </h1>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。
      </p>

      {sent ? (
        <p
          role="status"
          className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          {RESET_REQUEST_ACK_MESSAGE}
        </p>
      ) : null}

      <form action={requestReset} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          メールアドレス
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
        >
          再設定リンクを送信
        </button>
      </form>

      <a
        href="/login"
        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ログインページへ
      </a>
    </main>
  );
}
