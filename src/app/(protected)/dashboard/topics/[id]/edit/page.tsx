import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { validateTopicInput } from "@/lib/topic";

// 学習トピックの編集（LAP-006 §3 / §4-B）。
// 認証・データ分離は二層: ページ・server action 冒頭で requireUserId() を呼び、
// 取得・更新は where:{id,userId} を併用して他ユーザーの行に触れないようにする（§7.5）。

// 期限日を <input type="date"> の value（yyyy-MM-dd）へ整形する。
function toDateInputValue(deadline: Date | null): string {
  if (!deadline) return "";
  return deadline.toISOString().slice(0, 10);
}

export default async function EditTopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;

  // データ分離: where:{id,userId} で取得。他人の行・不在は一様に not_found へ。
  const topic = await prisma.topic.findFirst({
    where: { id, userId },
    select: { id: true, title: true, description: true, deadline: true },
  });

  if (!topic) {
    redirect("/dashboard/topics?result=not_found");
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">トピックを編集</h1>

      <form
        action={updateTopic}
        className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-800"
      >
        <input type="hidden" name="id" value={topic.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            タイトル<span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            name="title"
            required
            maxLength={200}
            defaultValue={topic.title}
            className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">詳細（任意）</span>
          <textarea
            name="description"
            rows={2}
            defaultValue={topic.description ?? ""}
            className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">期限日（任意）</span>
          <input
            type="date"
            name="deadline"
            defaultValue={toDateInputValue(topic.deadline)}
            className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            更新
          </button>
          <Link
            href="/dashboard/topics"
            className="rounded px-3 py-1.5 text-sm font-medium text-gray-500 hover:underline"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </main>
  );
}

// 更新（server action・§4-B）。認証はセッション由来 userId で行い、where:{id,userId} を併用する。
async function updateTopic(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");

  const back = (kind: string) =>
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

  // データ分離: updateMany の where:{id,userId} で他人の行を更新できないようにする。
  const { count } = await prisma.topic.updateMany({
    where: { id, userId },
    data: validation.value,
  });

  if (count === 0) {
    back("not_found"); // 対象なし or 他人の行を一様に扱う。
    return;
  }

  revalidatePath("/dashboard/topics");
  back("updated");
}
