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
import { joinTopicTotals, type TopicSum } from "@/lib/aggregate";

// 秒を「H時間M分」/「M分」へ整形（per-topic 累計表示・LAP-015 (b)）。
function formatHm(totalSeconds: number): string {
  const totalMin = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

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

  const [topics, sumsRaw] = await Promise.all([
    prisma.topic.findMany({
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
    }),
    // (b・LAP-015) per-topic 累計学習時間。where:{userId} でデータ分離（§7.5）。
    // 表示はアーカイブ外トピックのみだが、id 結合（joinTopicTotals）で絞られる。
    prisma.studyRecord.groupBy({
      by: ["topicId"],
      where: { userId },
      _sum: { countedSeconds: true },
    }),
  ]);

  // topicId → 累計秒のマップ（joinTopicTotals を流用・id 一致のみ採用）。
  const sums: TopicSum[] = sumsRaw.map((g) => ({
    topicId: g.topicId,
    totalSeconds: g._sum.countedSeconds ?? 0,
  }));
  const totalsById = new Map(
    joinTopicTotals(
      topics.map((t) => ({ id: t.id, title: t.title })),
      sums,
    ).map((t) => [t.topicId, t.totalSeconds]),
  );

  return (
    <div className="flex flex-col gap-6">
      {/* WF .page-h（見出し + spacer + link + 新規ボタン）。タイトルは shell トップバーが描画。 */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold">
          トピック
        </h3>
        <span className="flex-1" />
        <Link
          href="/dashboard/topics/archived"
          className="text-xs text-ink underline underline-offset-2"
        >
          アーカイブ済みを表示
        </Link>
        <a
          href="#new-topic"
          className="inline-flex min-h-[34px] items-center justify-center rounded-ctl bg-btn px-4 text-xs text-btn-ink"
        >
          ＋ 新規トピック
        </a>
      </div>

      {result && isResultKind(result) ? <ResultBanner kind={result} /> : null}

      <form
        id="new-topic"
        action={createTopic}
        className="flex flex-col gap-3 rounded-card border border-line bg-card p-6"
      >
        <p className="font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
          新しいトピックを作成
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            タイトル<span className="text-ink-dim">*</span>
          </span>
          <input
            type="text"
            name="title"
            required
            maxLength={200}
            placeholder="基本情報技術者試験（FE）"
            className="min-h-[44px] rounded-ctl border border-line-2 bg-fill px-3 text-sm placeholder:text-placeholder"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">詳細（任意）</span>
          <textarea
            name="description"
            rows={2}
            className="rounded-ctl border border-line-2 bg-fill px-3 py-2 text-sm placeholder:text-placeholder"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">期限日（任意）</span>
          <input
            type="date"
            name="deadline"
            className="min-h-[44px] rounded-ctl border border-line-2 bg-fill px-3 text-sm"
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-[34px] items-center justify-center self-start rounded-ctl bg-btn px-4 text-xs text-btn-ink"
        >
          作成
        </button>
      </form>

      {topics.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-2 px-6 py-8 text-center text-xs leading-7 text-ink-dim">
          まだトピックがありません。上のフォームから作成してください。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((t) => {
            const total = totalsById.get(t.id) ?? 0;
            return (
              <li
                key={t.id}
                className="flex flex-col gap-2 rounded-card border border-line bg-card p-6"
              >
                <span className="font-[family-name:var(--font-fredoka)] font-semibold">
                  {t.title}
                </span>
                {t.description ? (
                  <span className="text-[11px] text-ink-dim">{t.description}</span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-dim">
                  <span className="inline-block rounded-full border border-line-2 bg-fill px-2 py-0.5">
                    期限: {formatDeadline(t.deadline)}
                  </span>
                  <span>累計 {formatHm(total)}</span>
                </div>

                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/topics/${t.id}/edit`}
                    className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-line-2 px-4 text-xs text-ink"
                  >
                    編集
                  </Link>
                  <form action={archiveTopic}>
                    <input type="hidden" name="id" value={t.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-line-2 px-4 text-xs text-ink"
                    >
                      アーカイブ
                    </button>
                  </form>
                  <form action={deleteTopic}>
                    <input type="hidden" name="id" value={t.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-dashed border-error px-4 text-xs text-error"
                    >
                      削除
                    </button>
                  </form>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] leading-6 text-ink-dim">
        ※ 学習記録のあるトピックは削除できません。記録を残したまま一覧から外す場合は「アーカイブ」をご利用ください。アーカイブ済みは「アーカイブ済みを表示」から閲覧・復元できます。
      </p>
    </div>
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
          ? "rounded-ctl border border-line bg-panel px-3 py-2.5 text-xs text-ink"
          : "flex gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
      }
    >
      {messages[kind]}
    </p>
  );
}
