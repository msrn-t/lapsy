import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAdminId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getMailer } from "@/lib/mailer";
import {
  buildInviteUrl,
  computeExpiry,
  generateInviteToken,
  isValidEmail,
  normalizeEmail,
} from "@/lib/invitation";

// 管理者専用 招待送信 UI（LAP-003 §3-F）。
// 認可は二層: (1) authorized で /admin 配下を保護（auth.config.ts）、
// (2) server action / ページ冒頭で requireAdminId()（共通ヘルパ）で管理者を必須化する。
// 招待リンクの base URL は AUTH_URL を流用する（§4 / .env.example）。

type ResultKind =
  | "success"
  | "mail_failed"
  | "already_registered"
  | "duplicate_pending"
  | "invalid_email"
  | "forbidden";

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

export default async function AdminInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; email?: string }>;
}) {
  // ページ表示時にも管理者を必須化（非管理者は /dashboard へ）。
  await requireAdminId();

  const { result, email } = await searchParams;

  async function invite(formData: FormData) {
    "use server";

    // 二層目の認可（server action 冒頭で必ずサーバ側判定）。
    const adminId = await requireAdminId();

    const rawEmail = String(formData.get("email") ?? "");
    const targetEmail = normalizeEmail(rawEmail);

    const back = (kind: ResultKind) =>
      redirect(
        `/admin/invite?result=${kind}&email=${encodeURIComponent(targetEmail)}`,
      );

    if (!isValidEmail(targetEmail)) {
      back("invalid_email");
    }

    // 登録済みメールへの招待は拒否（§3-B 3）。
    const existingUser = await prisma.user.findUnique({
      where: { email: targetEmail },
    });
    if (existingUser) {
      back("already_registered");
    }

    const now = new Date();
    const token = generateInviteToken();

    // 有効 pending 判定 + expired 掃除 + INSERT を 1 トランザクションで原子化（§3-B 4）。
    try {
      await prisma.$transaction(async (tx) => {
        const pendings = await tx.invitation.findMany({
          where: { email: targetEmail, status: "pending" },
        });

        // 有効な pending（期限内）があれば重複として中断。
        if (pendings.some((p) => p.expiresAt.getTime() > now.getTime())) {
          throw new DuplicatePendingError();
        }

        // 期限切れ pending は expired へ遷移（部分ユニークの対象外にする）。
        const expiredIds = pendings
          .filter((p) => p.expiresAt.getTime() <= now.getTime())
          .map((p) => p.id);
        if (expiredIds.length > 0) {
          await tx.invitation.updateMany({
            where: { id: { in: expiredIds } },
            data: { status: "expired" },
          });
        }

        await tx.invitation.create({
          data: {
            email: targetEmail,
            token,
            status: "pending",
            expiresAt: computeExpiry(now),
            invitedById: adminId,
          },
        });
      });
    } catch (err) {
      if (err instanceof DuplicatePendingError) {
        back("duplicate_pending");
      }
      // 部分ユニーク衝突（同時に別リクエストが有効 pending を作成）→ 重複へ写像（TOCTOU 最終防壁）。
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        back("duplicate_pending");
      }
      throw err;
    }

    // 送信はトランザクションの外（コミット後・§3-B 5）。
    const mailer = getMailer();
    const sent = await mailer.sendInvitation({
      to: targetEmail,
      inviteUrl: buildInviteUrl(baseUrl(), token),
    });

    back(sent.ok ? "success" : "mail_failed");
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">ユーザーを招待</h1>

      {result ? <ResultBanner kind={result as ResultKind} email={email} /> : null}

      <form action={invite} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          招待先メールアドレス
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue={email ?? ""}
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
        >
          招待を送信
        </button>
      </form>

      <p className="text-sm text-gray-500">
        ※ 招待リンクの有効期限は72時間です。期限切れ後は同じメールアドレスへ再招待できます。
      </p>
    </main>
  );
}

function ResultBanner({ kind, email }: { kind: ResultKind; email?: string }) {
  const ok = kind === "success";
  const messages: Record<ResultKind, string> = {
    success: `${email ?? ""} に招待を送信しました。`,
    mail_failed: `招待は作成しましたが、${email ?? ""} へのメール送信に失敗しました。再送は期限切れ後に行えます。`,
    already_registered: `${email ?? ""} は既に登録済みのため招待できません。`,
    duplicate_pending: `${email ?? ""} には有効な招待が既に存在します（期限切れ後に再招待できます）。`,
    invalid_email: "メールアドレスの形式が正しくありません。",
    forbidden: "この操作を行う権限がありません。",
  };

  return (
    <p
      role="alert"
      className={
        ok
          ? "rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
          : "rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
      }
    >
      {messages[kind]}
    </p>
  );
}

// トランザクション内から重複 pending を伝播させるための内部エラー型。
class DuplicatePendingError extends Error {
  constructor() {
    super("DUPLICATE_PENDING");
    this.name = "DuplicatePendingError";
  }
}
