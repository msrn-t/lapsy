import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { computeRestoreMutation } from "@/lib/topic";
import { joinTopicTotals, type TopicSum } from "@/lib/aggregate";

// 秒を「H時間M分」/「M分」へ整形（per-topic 累計表示・LAP-015 (b)）。
function formatHm(totalSeconds: number): string {
  const totalMin = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

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

  const [topics, sumsRaw] = await Promise.all([
    prisma.topic.findMany({
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
    }),
    // (b・LAP-015) per-topic 累計。アーカイブ済みでも StudyRecord は残存（§7.4・物理削除しない）。
    // where:{userId} でデータ分離（§7.5）。id 結合で当該トピックのみ採用。
    prisma.studyRecord.groupBy({
      by: ["topicId"],
      where: { userId },
      _sum: { countedSeconds: true },
    }),
  ]);

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
      {/* WF .page-h（戻り link + 見出し）。タイトルは shell トップバーが描画。 */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/topics"
          className="text-xs text-ink underline underline-offset-2"
        >
          ← トピック一覧に戻る
        </Link>
        <span className="flex-1" />
        <h3 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold">
          アーカイブ済み
        </h3>
      </div>

      {result && isResultKind(result) ? <ResultBanner kind={result} /> : null}

      {topics.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-2 px-6 py-8 text-center text-xs leading-7 text-ink-dim">
          アーカイブ済みのトピックはありません。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((t) => {
            const total = totalsById.get(t.id) ?? 0;
            return (
              <li
                key={t.id}
                className="flex flex-col gap-2 rounded-card border border-line bg-panel p-6"
              >
                <span className="font-[family-name:var(--font-fredoka)] font-semibold text-ink-dim">
                  {t.title}
                </span>
                {t.description ? (
                  <span className="text-[11px] text-ink-dim">{t.description}</span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-dim">
                  <span className="inline-block rounded-full border border-line-2 bg-fill px-2 py-0.5">
                    アーカイブ済み
                  </span>
                  <span>アーカイブ日: {formatArchivedAt(t.archivedAt)}</span>
                  <span>累計 {formatHm(total)}</span>
                </div>

                <form action={restoreTopic} className="mt-1">
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    type="submit"
                    className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-line-2 px-4 text-xs text-ink"
                  >
                    復元
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-1.5 text-[11px] text-ink-dim">
        ※ アーカイブ済みトピックの過去の学習記録は横断集計（ヒートマップ・移動平均）には引き続き含まれます（§7.4）。
      </p>
    </div>
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
          ? "rounded-ctl border border-line bg-panel px-3 py-2.5 text-xs text-ink"
          : "flex gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
      }
    >
      {messages[kind]}
    </p>
  );
}
