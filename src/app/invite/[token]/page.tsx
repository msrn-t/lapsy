import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { BrandIcon } from "@/components/brand-icon";
import {
  evaluateInvitation,
  validateInvitePassword,
} from "@/lib/invitation";
import { InviteAcceptForm } from "./_form";

// 公開受諾ページ（LAP-003 §3-E）。
// authorized は /dashboard・/admin のみ保護するため /invite/[token] は公開のまま。
// GET: evaluateInvitation で検証 → 無効なら理由別エラー、有効ならパスワード設定フォーム。
// POST(server action): 再検証 + User 作成 + Invitation 条件付き更新を $transaction で原子化。

type AcceptError =
  | "not_found"
  | "already_accepted"
  | "expired"
  | "already_registered"
  | "weak_password";

const ERROR_MESSAGES: Record<AcceptError, string> = {
  not_found: "招待リンクが無効です。リンクが正しいかご確認ください。",
  already_accepted: "この招待は既に使用されています。ログインしてください。",
  expired: "招待リンクの有効期限が切れています。管理者へ再招待を依頼してください。",
  already_registered:
    "このメールアドレスは既に登録済みです。ログインしてください。",
  weak_password: "パスワードは8文字以上で設定してください。",
};

export default async function InviteAcceptPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const inv = await prisma.invitation.findUnique({ where: { token } });
  const check = evaluateInvitation(inv, new Date());

  if (!check.valid) {
    return <ErrorCard message={ERROR_MESSAGES[check.reason]} />;
  }

  // 有効な招待。email は招待レコードの値で固定表示する。
  const email = inv!.email;

  async function accept(formData: FormData) {
    "use server";

    const password = String(formData.get("password") ?? "");

    const back = (err: AcceptError) =>
      redirect(`/invite/${encodeURIComponent(token)}?error=${err}`);

    const pv = validateInvitePassword(password);
    if (!pv.ok) {
      back("weak_password");
    }

    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.invitation.findUnique({ where: { token } });
        const recheck = evaluateInvitation(fresh, new Date());
        if (!recheck.valid) {
          throw new AcceptFlowError(recheck.reason);
        }

        const passwordHash = await hashPassword(password);

        // User.email @unique が最終防壁（同時受諾・既存ユーザー化を弾く）。
        await tx.user.create({
          data: {
            email: fresh!.email,
            passwordHash,
            isAdmin: false,
          },
        });

        // 二重受諾防止: status=pending のときのみ accepted へ更新。
        const upd = await tx.invitation.updateMany({
          where: { token, status: "pending" },
          data: { status: "accepted", acceptedAt: new Date() },
        });
        if (upd.count === 0) {
          throw new AcceptFlowError("already_accepted");
        }
      });
    } catch (err) {
      if (err instanceof AcceptFlowError) {
        back(err.reason);
      }
      // User.email 衝突（既に登録済み）→ already_registered へ写像。
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        back("already_registered");
      }
      throw err;
    }

    // 受諾完了 → ログイン誘導（成功メッセージ付き・自動 signIn はしない・§3-E）。
    redirect("/login?accepted=1");
  }

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

        <h1 className="text-center font-[family-name:var(--font-fredoka)] text-[17px] font-medium text-ink">
          アカウントを登録
        </h1>
        <p className="mb-6 mt-1.5 text-center text-xs leading-relaxed text-ink-dim">
          招待されたメールアドレスにパスワードを設定すると、登録が完了します。
        </p>

        <InviteAcceptForm action={accept} email={email} initialError={error} />

        <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-dim">
          この招待リンクの有効期限は発行から72時間です。
        </p>
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
          招待を受け付けできません
        </h1>
        <p
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
        >
          {message}
        </p>
        <p className="text-center">
          <a
            href="/login"
            className="text-xs text-ink underline underline-offset-2"
          >
            ログイン画面へ
          </a>
        </p>
      </div>
    </main>
  );
}

// トランザクション内から受諾失敗理由を伝播させる内部エラー型。
class AcceptFlowError extends Error {
  constructor(public readonly reason: AcceptError) {
    super(reason);
    this.name = "AcceptFlowError";
  }
}
