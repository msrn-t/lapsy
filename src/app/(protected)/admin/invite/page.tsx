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
  summarizeInvitationRow,
} from "@/lib/invitation";

// 管理者専用 招待送信 UI + 招待履歴（LAP-003 §3-F / LAP-015 (d) WF 09）。
// 認可は二層: (1) authorized で /admin 配下を保護（auth.config.ts）、
// (2) server action / ページ冒頭で requireAdminId()（共通ヘルパ）で管理者を必須化する。
// 招待リンクの base URL は AUTH_URL を流用する（§4 / .env.example）。
// LAP-015: 招待履歴テーブルと再送導線（resendInvite）を追加。既存 invite フローは不変。

type ResultKind =
  | "success"
  | "resent" // 再送（LAP-015 (d)）。一様 ACK 方針で pending 以外でも返す。
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

  // (d・LAP-015) 招待履歴。admin 限定ページ（招待管理は横断的に全招待を見るのが仕様）。
  const now = new Date();
  const invitations = await prisma.invitation.findMany({
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

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

  // (d・LAP-015) 招待の再送（pending のみ）。既存 invite の token 発行・一様 ACK 方針と整合させる。
  // 「再送 = 期限延長 + 新リンク」: 新トークン発行 + computeExpiry(now) で期限を再設定する
  // （既存 invite の「期限切れ pending → expired 化して新規発行」と一貫）。
  // 一様 ACK: 対象が pending でない/存在しない場合も resent を返し、招待の有無を漏らさない。
  async function resendInvite(formData: FormData) {
    "use server";

    // 二層目の認可（server action 冒頭で必ずサーバ側判定・既存 invite と同方針）。
    await requireAdminId();

    const id = String(formData.get("id") ?? "");

    const back = (kind: ResultKind, addr?: string) =>
      redirect(
        `/admin/invite?result=${kind}${addr ? `&email=${encodeURIComponent(addr)}` : ""}`,
      );

    // pending のみ対象（accepted/expired は再送しない）。無ければ一様に resent ACK（列挙防止）。
    const target = await prisma.invitation.findFirst({
      where: { id, status: "pending" },
      select: { id: true, email: true, expiresAt: true },
    });
    if (!target) {
      back("resent"); // 存在の有無を漏らさない一様応答。
      return;
    }

    const sendNow = new Date();
    const token = generateInviteToken();

    // 新トークン + 期限再設定で当該レコードを更新（status は pending 維持）。
    await prisma.invitation.update({
      where: { id: target.id },
      data: { token, expiresAt: computeExpiry(sendNow) },
    });

    // 送信は更新コミット後（既存 invite と同様トランザクション外・§3-B 5）。
    const mailer = getMailer();
    const sent = await mailer.sendInvitation({
      to: target.email,
      inviteUrl: buildInviteUrl(baseUrl(), token),
    });

    back(sent.ok ? "resent" : "mail_failed", target.email);
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="mx-auto flex w-full max-w-[520px] flex-col gap-4">
        <h3 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold">
          招待を送信
        </h3>

        {result ? (
          <ResultBanner kind={result as ResultKind} email={email} />
        ) : null}

        <form
          action={invite}
          className="flex flex-col gap-3 rounded-card border border-line bg-card p-6"
        >
          <label className="flex flex-col gap-1 text-sm">
            招待先メールアドレス
            <div className="flex flex-wrap items-end gap-2">
              <input
                name="email"
                type="email"
                required
                autoComplete="off"
                defaultValue={email ?? ""}
                className="min-h-[44px] flex-1 rounded-ctl border border-line-2 bg-fill px-3 text-sm placeholder:text-placeholder"
              />
              <button
                type="submit"
                className="inline-flex min-h-[34px] items-center justify-center rounded-ctl bg-btn px-4 text-xs text-btn-ink"
              >
                招待を送信
              </button>
            </div>
          </label>
          <p className="text-[11px] text-ink-dim">
            ※ 招待リンクの有効期限は72時間です。期限切れ後は同じメールアドレスへ再招待できます。
          </p>
        </form>
      </div>

      {/* (d・LAP-015) 招待履歴テーブル（メール / 状態 / 有効期限 / 再送）。 */}
      <section className="flex flex-col gap-2">
        <p className="font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
          招待履歴
        </p>
        {invitations.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-2 px-6 py-8 text-center text-xs leading-7 text-ink-dim">
            まだ招待履歴がありません。
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-card">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                    メールアドレス
                  </th>
                  <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                    状態
                  </th>
                  <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                    有効期限
                  </th>
                  <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                    再送
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const view = summarizeInvitationRow(inv, now);
                  return (
                    <tr key={inv.id}>
                      <td className="border-b border-line px-3 py-2.5 text-left text-ink">
                        {inv.email}
                      </td>
                      <td className="border-b border-line px-3 py-2.5 text-left">
                        <span
                          className={
                            view.statusLabel === "accepted"
                              ? "inline-block rounded-full border border-line-strong bg-[#ECECEC] px-2 py-0.5 text-[10px] text-ink"
                              : "inline-block rounded-full border border-line-2 bg-[#ECECEC] px-2 py-0.5 text-[10px] text-ink-dim"
                          }
                        >
                          {view.statusLabel}
                        </span>
                      </td>
                      <td className="border-b border-line px-3 py-2.5 text-left text-ink-dim">
                        {view.expiryLabel}
                      </td>
                      <td className="border-b border-line px-3 py-2.5 text-left">
                        {view.canResend ? (
                          <form action={resendInvite}>
                            <input type="hidden" name="id" value={inv.id} />
                            <button
                              type="submit"
                              className="text-xs text-ink underline underline-offset-2"
                            >
                              再送
                            </button>
                          </form>
                        ) : (
                          <span className="text-ink-dim">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ResultBanner({ kind, email }: { kind: ResultKind; email?: string }) {
  const ok = kind === "success" || kind === "resent";
  const messages: Record<ResultKind, string> = {
    success: `${email ?? ""} に招待を送信しました。`,
    resent: `${email ? `${email} に` : ""}招待を再送しました（新しいリンク・有効期限を再設定）。`,
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
          ? "rounded-ctl border border-line bg-panel px-3 py-2.5 text-xs text-ink"
          : "flex gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
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
