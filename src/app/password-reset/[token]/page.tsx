import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { BrandIcon } from "@/components/brand-icon";
import {
  RESET_INVALID_LINK_MESSAGE,
  evaluatePasswordResetToken,
  hashResetToken,
  validateNewPassword,
} from "@/lib/password-reset";
import { ResetPerformForm } from "./_form";

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
          新しいパスワードを設定
        </h1>
        <p className="mb-6 mt-1.5 text-center text-xs leading-relaxed text-ink-dim">
          新しいログイン用パスワードを設定してください。
        </p>

        <ResetPerformForm
          action={resetPassword}
          errorMessage={
            error
              ? error === "weak_password"
                ? "パスワードは8文字以上で設定してください。"
                : RESET_INVALID_LINK_MESSAGE
              : undefined
          }
        />
      </div>
    </main>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center">
      <div className="w-full max-w-[380px] rounded-card border border-line bg-card px-6 py-8">
        {/* ブランド */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandIcon size={52} />
          <span className="font-[family-name:var(--font-fredoka)] text-[24px] font-semibold leading-none text-ink">
            Lapsy
          </span>
          <span className="text-[11px] text-ink-dim">
            ラップで積み上げる、資格学習タイマー
          </span>
        </div>

        <h1 className="mb-6 text-center font-[family-name:var(--font-fredoka)] text-[17px] font-medium text-ink">
          パスワードを再設定できません
        </h1>
        <p
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
        >
          {message}
        </p>
        <p className="text-center">
          <a
            href="/password-reset"
            className="text-xs text-ink underline underline-offset-2"
          >
            リセットを再申請する
          </a>
        </p>
      </div>
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
