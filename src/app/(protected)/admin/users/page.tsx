import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser, requireAdminId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  evaluateAdminFlagChange,
  type AdminAction,
  type AdminGuardResult,
} from "@/lib/admin-guard";

// 管理者用ユーザー一覧 + 管理者フラグ・トグル（LAP-004 §3-1 / §4）。
// 認可は二層: (1) auth.config の authorized で /admin 配下をログイン必須に保護、
// (2) ページ・server action 冒頭で requireAdminId()（非管理者は /dashboard へ）。
// 最後の管理者保護の TOCTOU は剥奪時の条件付き原子 UPDATE（§3-3）で担保する。

type ResultKind =
  | "granted"
  | "revoked"
  | "self_demotion"
  | "last_admin"
  | "target_not_found"
  | "forbidden"
  | "noop";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  // ページ表示も管理者必須（非管理者は /dashboard へ）。
  const actorId = await requireAdminId();
  const { result } = await searchParams;

  const users = await prisma.user.findMany({
    select: { id: true, email: true, isAdmin: true },
    orderBy: { email: "asc" },
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">ユーザー管理</h1>

      {result ? <ResultBanner kind={result as ResultKind} /> : null}

      <ul className="flex flex-col divide-y divide-gray-200 rounded border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {users.map((u) => {
          const isSelf = u.id === actorId;
          return (
            <li
              key={u.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">{u.email}</span>
                <span
                  className={
                    u.isAdmin
                      ? "text-xs text-green-700 dark:text-green-400"
                      : "text-xs text-gray-500"
                  }
                >
                  {u.isAdmin ? "管理者" : "一般ユーザー"}
                  {isSelf ? "（あなた）" : ""}
                </span>
              </span>

              <form action={toggleAdmin}>
                <input type="hidden" name="targetId" value={u.id} />
                <input
                  type="hidden"
                  name="action"
                  value={u.isAdmin ? "revoke" : "grant"}
                />
                <button
                  type="submit"
                  // 自分自身の剥奪は UI でも無効化（サーバ側ガードが正・§4）。
                  disabled={u.isAdmin && isSelf}
                  className={
                    u.isAdmin
                      ? "rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                      : "rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                  }
                >
                  {u.isAdmin ? "管理者を剥奪" : "管理者を付与"}
                </button>
              </form>
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-gray-500">
        ※ 剥奪すると対象ユーザーは強制ログアウトされ、再ログインが必要になります。自分自身の管理者権限は剥奪できません。システム上で最後の管理者となる剥奪も拒否されます。
      </p>
    </main>
  );
}

// 管理者フラグの付与・剥奪（server action・§4-B）。
// 認可はセッション由来の操作者で判定し、クライアントの hidden field は信頼しない。
async function toggleAdmin(formData: FormData) {
  "use server";

  // 二層目の認可（必須・§3-5）。非管理者・未認証はここで redirect される。
  const actorId = await requireAdminId();
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");

  const targetId = String(formData.get("targetId") ?? "");
  const rawAction = String(formData.get("action") ?? "");
  const action: AdminAction = rawAction === "revoke" ? "revoke" : "grant";

  const back = (kind: ResultKind) =>
    redirect(`/admin/users?result=${kind}`);

  // プリチェック（純関数・§3-2）。最終的な最後の管理者保護は DB 原子 UPDATE が正。
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, isAdmin: true },
  });
  const otherAdminCount = await prisma.user.count({
    where: { isAdmin: true, id: { not: targetId } },
  });

  const verdict: AdminGuardResult = evaluateAdminFlagChange({
    actorIsAdmin: actor.isAdmin,
    actorId,
    targetId,
    targetExists: !!target,
    targetIsAdmin: target?.isAdmin ?? false,
    action,
    otherAdminExists: otherAdminCount > 0,
  });

  if (!verdict.ok) {
    back(verdict.reason); // 操作は行わず結果を通知。
  }

  if (action === "revoke") {
    // 剥奪: 条件付き原子 UPDATE（§3-3）。最後の管理者保護・自己降格を where に内包し、
    // sessionVersion + 1（強制ログアウト・§3-4）を同一 UPDATE に畳み込む。
    // 別途 bumpSessionVersion は呼ばない（二重 bump 回避）。
    // $executeRaw のタグ付きテンプレートでパラメタライズ（SQL インジェクション防止）。
    // PostgreSQL は PascalCase の識別子をダブルクォートで囲む必要がある。
    const affected = await prisma.$transaction(
      (tx) =>
        tx.$executeRaw`
          UPDATE "User"
             SET "isAdmin" = false,
                 "sessionVersion" = "sessionVersion" + 1
           WHERE "id" = ${targetId}
             AND "isAdmin" = true
             AND "id" <> ${actorId}
             AND (SELECT COUNT(*) FROM "User" WHERE "isAdmin" = true) > 1
        `,
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // affected=0 は「最後の管理者」または競合により既に剥奪済み。
    if (affected === 0) {
      back("last_admin");
    }
    revalidatePath("/admin/users");
    back("revoked");
  }

  // 付与: 既に true なら no-op。bump しない（§3-4・次回アクセスで token.isAdmin 反映）。
  if (target?.isAdmin) {
    back("noop");
  }
  await prisma.user.update({
    where: { id: targetId },
    data: { isAdmin: true },
  });
  revalidatePath("/admin/users");
  back("granted");
}

function ResultBanner({ kind }: { kind: ResultKind }) {
  const ok = kind === "granted" || kind === "revoked" || kind === "noop";
  const messages: Record<ResultKind, string> = {
    granted: "管理者フラグを付与しました。",
    revoked:
      "管理者フラグを剥奪しました。対象ユーザーは次回アクセス時に強制ログアウトされます。",
    noop: "対象は既にその状態のため、変更はありませんでした。",
    self_demotion: "自分自身の管理者フラグは剥奪できません（自己降格不可）。",
    last_admin:
      "システム上で最後の管理者となるため、剥奪できません（管理者ゼロ状態の防止）。",
    target_not_found: "対象のユーザーが見つかりませんでした。",
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
