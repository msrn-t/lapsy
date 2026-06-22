import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import {
  RESET_INVALID_LINK_MESSAGE,
  evaluatePasswordResetToken,
  hashResetToken,
  validateNewPassword,
} from "@/lib/password-reset";

// 公開リセット実行ページ（LAP-005 §3-F）。
// authorized は /dashboard・/admin のみ保護するため /password-reset/[token] は公開のまま。
// GET: URL の生トークンを sha256 化 → findUnique → evaluatePasswordResetToken で検証。
//      無効（not_found / used / expired）は理由を出し分けず一様メッセージで表示（§3-C）。
// POST(server action): $transaction で「再検証 + 条件付き used 化 + パスワード更新」を原子化。
//      使用済み・期限切れ・不正は区別せず一様エラーへ写像する。

export default async function PasswordResetExecutePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token: rawToken } = await params;
  const { error } = await searchParams;

  const hashed = hashResetToken(rawToken);
  const rec = await prisma.passwordResetToken.findUnique({
    where: { token: hashed },
  });
  const check = evaluatePasswordResetToken(rec, new Date());

  // 無効（not_found / used / expired いずれも）→ 一様な無効リンク画面（§3-C）。
  if (!check.valid) {
    return <ErrorCard message={RESET_INVALID_LINK_MESSAGE} />;
  }

  async function resetPassword(formData: FormData) {
    "use server";

    const password = String(formData.get("password") ?? "");
    const hashedInner = hashResetToken(rawToken);

    const backWeak = () =>
      redirect(
        `/password-reset/${encodeURIComponent(rawToken)}?error=weak_password`,
      );

    const pv = validateNewPassword(password);
    if (!pv.ok) {
      backWeak();
    }

    try {
      await prisma.$transaction(async (tx) => {
        // a. 再取得して再検証（TOCTOU を狭める）。無効なら throw（一様エラー）。
        const fresh = await tx.passwordResetToken.findUnique({
          where: { token: hashedInner },
        });
        const recheck = evaluatePasswordResetToken(fresh, new Date());
        if (!recheck.valid) {
          throw new ResetFlowError();
        }

        // b. bcrypt でパスワードをハッシュ化（§3-A 役割分担）。
        const passwordHash = await hashPassword(password);

        // c. 条件付き used 化（二重使用防止の最終防壁）。
        const upd = await tx.passwordResetToken.updateMany({
          where: { token: hashedInner, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (upd.count === 0) {
          throw new ResetFlowError();
        }

        // d. パスワード更新。
        await tx.user.update({
          where: { id: fresh!.userId },
          data: { passwordHash },
        });
      });
    } catch (err) {
      if (err instanceof ResetFlowError) {
        // 使用済み・期限切れ・不正を区別せず一様エラーへ（§3-C）。
        redirect(
          `/password-reset/${encodeURIComponent(rawToken)}?error=invalid_link`,
        );
      }
      throw err;
    }

    // 成功 → ログイン誘導（成功メッセージ付き・自動 signIn はしない・§3-F）。
    redirect("/login?reset=1");
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        新しいパスワードを設定
      </h1>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        新しいログイン用パスワードを設定してください。
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error === "weak_password"
            ? "パスワードは8文字以上で設定してください。"
            : RESET_INVALID_LINK_MESSAGE}
        </p>
      ) : null}

      <form action={resetPassword} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          新しいパスワード（8文字以上）
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
        >
          パスワードを更新
        </button>
      </form>
    </main>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        パスワードを再設定できません
      </h1>
      <p
        role="alert"
        className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
      >
        {message}
      </p>
      <a
        href="/password-reset"
        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        再度リセットを要求する
      </a>
    </main>
  );
}

// トランザクション内から失敗を伝播させる内部エラー型（理由は外部へ出さず一様化）。
class ResetFlowError extends Error {
  constructor() {
    super("reset_invalid");
    this.name = "ResetFlowError";
  }
}
