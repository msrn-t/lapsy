import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { computeRestoreMutation } from "@/lib/topic";

// アーカイブ済みトピックの一覧 + 復元（LAP-007 §3-3 / §4-D）。
// 認証・データ分離は二層: (1) auth.config の authorized で /dashboard 配下を保護、
// (2) ページ・server action 冒頭で requireUserId()（未認証は /login へ）。
// 全クエリは requireUserId() 由来 userId でフィルタし、更新は where:{id,userId} を併用する（§7.5）。
// 復元は UPDATE のみ（StudyRecord/StudySession は物理削除しない・§7.4 の前提を担保）。

type ResultKind = "restored" | "not_found";

const SUCCESS_KINDS: ReadonlySet<ResultKind> = new Set<ResultKind>(["restored"]);

function isResultKind(value: string): value is ResultKind {
  return value === "restored" || value === "not_found";
}

// アーカイブ日時を表示用に整形する（yyyy-MM-dd）。
function formatArchivedAt(archivedAt: Date | null): string {
  if (!archivedAt) return "—";
  return archivedAt.toISOString().slice(0, 10);
}

export default async function ArchivedTopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  // ページ表示も認証必須（未認証は /login へ）。
  const userId = await requireUserId();
  const { result } = await searchParams;

  const topics = await prisma.topic.findMany({
    // データ分離（§7.5）＋ アーカイブ済みのみ（LAP-007 §3-3）。@@index([userId, isArchived]) が効く。
    where: { userId, isArchived: true },
    select: {
      id: true,
      title: true,
      description: true,
      deadline: true,
      archivedAt: true,
    },
    orderBy: [{ archivedAt: "desc" }],
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">
          アーカイブ済みトピック
        </h1>
        <Link
          href="/dashboard/topics"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          トピック一覧へ戻る
        </Link>
      </div>

      {result && isResultKind(result) ? <ResultBanner kind={result} /> : null}

      {topics.length === 0 ? (
        <p className="text-sm text-gray-500">
          アーカイブ済みのトピックはありません。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-200 rounded border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {topics.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">{t.title}</span>
                {t.description ? (
                  <span className="text-xs text-gray-500">{t.description}</span>
                ) : null}
                <span className="text-xs text-gray-400">
                  アーカイブ日: {formatArchivedAt(t.archivedAt)}
                </span>
              </span>

              <form action={restoreTopic}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                >
                  復元
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// 復元（server action・LAP-007 §3-1 / §4-B）。
// UPDATE のみ（StudyRecord/StudySession は物理削除しない・§7.4 の前提を担保）。
// where に isArchived:true を含めることで、未アーカイブ・不在・他人の行はすべて
// count===0 → not_found に一様化する（冪等・§3-5）。
async function restoreTopic(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/topics/archived?result=${kind}`);

  const { count } = await prisma.topic.updateMany({
    where: { id, userId, isArchived: true }, // ← データ分離（§7.5）＋ 冪等
    data: computeRestoreMutation(),
  });
  if (count === 0) {
    back("not_found"); // 未アーカイブ・不在・他人の行を一様に扱う。
    return;
  }

  // 復元後は両画面を再描画（通常一覧に再表示／アーカイブ一覧から消える）。
  revalidatePath("/dashboard/topics");
  revalidatePath("/dashboard/topics/archived");
  back("restored");
}

function ResultBanner({ kind }: { kind: ResultKind }) {
  const ok = SUCCESS_KINDS.has(kind);
  const messages: Record<ResultKind, string> = {
    restored: "トピックを復元しました。",
    not_found: "対象のトピックが見つかりませんでした。",
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
