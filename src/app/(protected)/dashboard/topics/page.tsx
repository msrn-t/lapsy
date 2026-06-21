import Link from "next/link";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  validateTopicInput,
  evaluateTopicDeletion,
  computeArchiveMutation,
} from "@/lib/topic";

// 学習トピックの一覧 + 作成 + 削除（LAP-006 §3 / §4）。
// 認証・データ分離は二層: (1) auth.config の authorized で /dashboard 配下をログイン必須に保護、
// (2) ページ・各 server action 冒頭で requireUserId()（未認証は /login へ）。
// 全クエリは requireUserId() 由来 userId でフィルタし、更新/削除は where:{id,userId} を併用する（§7.5）。
// 削除整合（§10 確定）: 記録あり/running は物理削除せずアーカイブ（LAP-007）へ誘導。
// 純関数プリチェック（UX 層）＋ FK Restrict（最終権威）の多層防御（§3-4）。

type ResultKind =
  | "created"
  | "updated"
  | "deleted"
  | "archived" // アーカイブ成功（LAP-007）
  | "title_required"
  | "title_too_long"
  | "invalid_deadline"
  | "not_found"
  | "delete_running" // running ラン進行中 → 終了を促す
  | "delete_has_records"; // 記録あり → アーカイブ（LAP-007）へ誘導

const SUCCESS_KINDS: ReadonlySet<ResultKind> = new Set<ResultKind>([
  "created",
  "updated",
  "deleted",
  "archived",
]);

function isResultKind(value: string): value is ResultKind {
  return (
    SUCCESS_KINDS.has(value as ResultKind) ||
    [
      "title_required",
      "title_too_long",
      "invalid_deadline",
      "not_found",
      "delete_running",
      "delete_has_records",
    ].includes(value)
  );
}

// 期限日を <input type="date"> 用の yyyy-MM-dd 文字列へ整形する（プリフィル用途は edit 側）。
function formatDeadline(deadline: Date | null): string {
  if (!deadline) return "期限なし";
  return deadline.toISOString().slice(0, 10);
}

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  // ページ表示も認証必須（未認証は /login へ）。
  const userId = await requireUserId();
  const { result } = await searchParams;

  const topics = await prisma.topic.findMany({
    // データ分離（§7.5）＋ アーカイブ済みを通常一覧から除外（LAP-007 §3-2）。
    // @@index([userId, isArchived]) がそのまま効く。
    where: { userId, isArchived: false },
    select: {
      id: true,
      title: true,
      description: true,
      deadline: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">学習トピック</h1>
        <Link
          href="/dashboard/topics/archived"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          アーカイブ済みを表示
        </Link>
      </div>

      {result && isResultKind(result) ? <ResultBanner kind={result} /> : null}

      <form
        action={createTopic}
        className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-800"
      >
        <h2 className="text-sm font-semibold">新しいトピックを作成</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            タイトル<span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            name="title"
            required
            maxLength={200}
            placeholder="例: 数学（線形代数）"
            className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">詳細（任意）</span>
          <textarea
            name="description"
            rows={2}
            className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">期限日（任意）</span>
          <input
            type="date"
            name="deadline"
            className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <button
          type="submit"
          className="self-start rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          作成
        </button>
      </form>

      {topics.length === 0 ? (
        <p className="text-sm text-gray-500">
          まだトピックがありません。上のフォームから作成してください。
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
                  期限: {formatDeadline(t.deadline)}
                </span>
              </span>

              <span className="flex items-center gap-2">
                <Link
                  href={`/dashboard/topics/${t.id}/edit`}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                >
                  編集
                </Link>
                <form action={archiveTopic}>
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    type="submit"
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                  >
                    アーカイブ
                  </button>
                </form>
                <form action={deleteTopic}>
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    type="submit"
                    className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    削除
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-gray-500">
        ※ 学習記録のあるトピックは削除できません。記録を残したまま一覧から外す場合は「アーカイブ」をご利用ください。アーカイブ済みは「アーカイブ済みを表示」から閲覧・復元できます。
      </p>
    </main>
  );
}

// 作成（server action・§4-A）。認証はセッション由来 userId で行い、クライアント入力を信頼しない。
async function createTopic(formData: FormData) {
  "use server";

  const userId = await requireUserId();

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/topics?result=${kind}`);

  const validation = validateTopicInput({
    title: String(formData.get("title") ?? ""),
    description: formData.get("description") as string | null,
    deadline: formData.get("deadline") as string | null,
  });

  if (!validation.ok) {
    back(validation.reason); // DB に触れず結果コードで通知。
    return;
  }

  await prisma.topic.create({
    data: { userId, ...validation.value },
  });
  revalidatePath("/dashboard/topics");
  back("created");
}

// 削除（server action・§4-C）— 削除整合の核。
// 件数集計 → 純関数プリチェック → 物理削除（記録なしのみ）。
// プリチェック後の TOCTOU は FK Restrict（P2003）を捕捉し delete_has_records へフォールバック（§3-4）。
async function deleteTopic(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/topics?result=${kind}`);

  // 件数集計（全て userId+topicId でフィルタ・データ分離）。
  const [runningSessionCount, studyRecordCount, studySessionCount] =
    await Promise.all([
      prisma.studySession.count({
        where: { userId, topicId: id, status: "running" },
      }),
      prisma.studyRecord.count({ where: { userId, topicId: id } }),
      prisma.studySession.count({ where: { userId, topicId: id } }),
    ]);

  const verdict = evaluateTopicDeletion({
    runningSessionCount,
    studyRecordCount,
    studySessionCount,
  });

  if (!verdict.ok) {
    back(verdict.reason === "running" ? "delete_running" : "delete_has_records");
    return;
  }

  // 物理削除（記録なしのみここに到達）。where:{id,userId} でデータ分離。
  try {
    const { count } = await prisma.topic.deleteMany({ where: { id, userId } });
    if (count === 0) {
      back("not_found"); // 対象なし or 他人の行を一様に扱う。
      return;
    }
  } catch (e) {
    // TOCTOU: プリチェック後に記録が生成された場合、FK Restrict が P2003 を投げる。
    // DB を最終権威にして物理削除を行わず、アーカイブ誘導へフォールバックする（§3-4）。
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      back("delete_has_records");
      return;
    }
    throw e;
  }

  revalidatePath("/dashboard/topics");
  back("deleted");
}

// アーカイブ（server action・LAP-007 §3-1 / §4-A）。
// UPDATE のみ（StudyRecord/StudySession は物理削除しない・§7.4 の前提を担保）。
// where に isArchived:false を含めることで、既アーカイブ・不在・他人の行はすべて
// count===0 → not_found に一様化する（冪等・§3-5）。
async function archiveTopic(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/topics?result=${kind}`);

  const { count } = await prisma.topic.updateMany({
    where: { id, userId, isArchived: false }, // ← データ分離（§7.5）＋ 冪等
    data: computeArchiveMutation(new Date()),
  });
  if (count === 0) {
    back("not_found"); // 既アーカイブ・不在・他人の行を一様に扱う。
    return;
  }

  revalidatePath("/dashboard/topics");
  back("archived");
}

function ResultBanner({ kind }: { kind: ResultKind }) {
  const ok = SUCCESS_KINDS.has(kind);
  const messages: Record<ResultKind, string> = {
    created: "トピックを作成しました。",
    updated: "トピックを更新しました。",
    deleted: "トピックを削除しました。",
    archived: "トピックをアーカイブしました。",
    title_required: "タイトルは必須です。入力してください。",
    title_too_long: "タイトルが長すぎます。短くしてください。",
    invalid_deadline: "期限日の形式が正しくありません。",
    not_found: "対象のトピックが見つかりませんでした。",
    delete_running:
      "このトピックは実行中のランがあります。ランを終了してから操作してください。",
    delete_has_records:
      "このトピックには学習記録があるため削除できません。記録を残す場合はアーカイブをご利用ください。",
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
