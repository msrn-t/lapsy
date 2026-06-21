import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import {
  evaluateInvitation,
  validateInvitePassword,
} from "@/lib/invitation";

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
    <main className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">パスワードを設定</h1>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        {email} の招待を受け付けます。ログイン用のパスワードを設定してください。
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {ERROR_MESSAGES[error as AcceptError] ?? "エラーが発生しました。"}
        </p>
      ) : null}

      <form action={accept} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          メールアドレス
          <input
            type="email"
            value={email}
            readOnly
            className="rounded border border-gray-300 bg-gray-100 px-3 py-2 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          パスワード（8文字以上）
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
          登録する
        </button>
      </form>
    </main>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">招待を受け付けできません</h1>
      <p
        role="alert"
        className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
      >
        {message}
      </p>
      <a
        href="/login"
        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ログインページへ
      </a>
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
