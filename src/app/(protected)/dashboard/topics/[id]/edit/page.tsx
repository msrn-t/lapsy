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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <h3 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold">
        トピックを編集
      </h3>

      <form
        action={updateTopic}
        className="flex flex-col gap-3 rounded-card border border-line bg-card p-6"
      >
        <input type="hidden" name="id" value={topic.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            タイトル<span className="text-ink-dim">*</span>
          </span>
          <input
            type="text"
            name="title"
            required
            maxLength={200}
            defaultValue={topic.title}
            className="min-h-[44px] rounded-ctl border border-line-2 bg-fill px-3 text-sm placeholder:text-placeholder"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">詳細（任意）</span>
          <textarea
            name="description"
            rows={2}
            defaultValue={topic.description ?? ""}
            className="rounded-ctl border border-line-2 bg-fill px-3 py-2 text-sm placeholder:text-placeholder"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">期限日（任意）</span>
          <input
            type="date"
            name="deadline"
            defaultValue={toDateInputValue(topic.deadline)}
            className="min-h-[44px] rounded-ctl border border-line-2 bg-fill px-3 text-sm"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex min-h-[34px] items-center justify-center rounded-ctl bg-btn px-4 text-xs text-btn-ink"
          >
            更新
          </button>
          <Link
            href="/dashboard/topics"
            className="text-xs text-ink-dim underline underline-offset-2"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
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
