import Link from "next/link";
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
    // (c・LAP-015) name / createdAt を追加（admin スコープ・requireAdminId 済）。
    select: { id: true, name: true, email: true, isAdmin: true, createdAt: true },
    orderBy: { email: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      {/* WF .page-h（見出し + 招待リンク）。タイトルは shell トップバーが描画。 */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold">
          ユーザー管理
        </h3>
        <span className="flex-1" />
        <Link
          href="/admin/invite"
          className="text-xs text-ink underline underline-offset-2"
        >
          ＋ 招待を送信
        </Link>
      </div>

      {result ? <ResultBanner kind={result as ResultKind} /> : null}

      {/* WF .tbl テーブル（名前 / メール / 管理者 / 登録日）。 */}
      <div className="overflow-hidden rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                名前
              </th>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                メールアドレス
              </th>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                管理者
              </th>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim">
                登録日
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === actorId;
              return (
                <tr key={u.id}>
                  <td className="border-b border-line px-3 py-2.5 text-left text-ink">
                    {u.name ?? "（未設定）"}
                    {isSelf ? "（あなた）" : ""}
                  </td>
                  <td className="border-b border-line px-3 py-2.5 text-left text-ink-dim">
                    {u.email}
                  </td>
                  <td className="border-b border-line px-3 py-2.5 text-left">
                    <form action={toggleAdmin} className="flex items-center gap-2">
                      <input type="hidden" name="targetId" value={u.id} />
                      <input
                        type="hidden"
                        name="action"
                        value={u.isAdmin ? "revoke" : "grant"}
                      />
                      {/* WF .switch 風トグル。実体は既存 toggleAdmin form（name 不変）。 */}
                      <button
                        type="submit"
                        // 自分自身の剥奪は UI でも無効化（サーバ側ガードが正・§4）。
                        disabled={u.isAdmin && isSelf}
                        aria-pressed={u.isAdmin}
                        title={u.isAdmin ? "管理者を剥奪" : "管理者を付与"}
                        className={
                          "relative inline-block h-[22px] w-[38px] rounded-full border border-line-2 transition-colors disabled:cursor-not-allowed disabled:opacity-45 " +
                          (u.isAdmin ? "bg-progress" : "bg-line-2")
                        }
                      >
                        <span
                          className={
                            "absolute top-0.5 h-4 w-4 rounded-full border border-line bg-white transition-all " +
                            (u.isAdmin ? "left-[18px]" : "left-0.5")
                          }
                        />
                      </button>
                    </form>
                  </td>
                  <td className="border-b border-line px-3 py-2.5 text-left text-ink-dim">
                    {u.createdAt.toISOString().slice(0, 10).replace(/-/g, "/")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-6 text-ink-dim">
        ※ 剥奪すると対象ユーザーは強制ログアウトされ、再ログインが必要になります。自分自身の管理者権限は剥奪できません。システム上で最後の管理者となる剥奪も拒否されます。
      </p>
    </div>
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
          ? "rounded-ctl border border-line bg-panel px-3 py-2.5 text-xs text-ink"
          : "flex gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
      }
    >
      {messages[kind]}
    </p>
  );
}
