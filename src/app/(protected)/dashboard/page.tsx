import Link from "next/link";
import { requireUserId, getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { materializeIfDue } from "@/lib/materialize";
import {
  toJstDateKey,
  jstDateKeyToUtcStart,
  bucketByJstDay,
  fillDailySeries,
  movingAverage,
  joinTopicTotals,
  computeDeadlineCountdowns,
  HEATMAP_WINDOW_DAYS,
  type TopicSum,
} from "@/lib/aggregate";
import { LogoutButton } from "../logout-button";
import {
  TopicTotalsChart,
  HeatmapChart,
  MovingAverageChart,
  CountdownList,
} from "./_charts";

// ダッシュボード集計と可視化（LAP-011 §3 / SPEC §4・§7.2・§7.4・§7.5）。
// 認証・データ分離は二層: (1) auth.config の authorized で /dashboard 配下をログイン必須に保護、
// (2) ページ冒頭で requireUserId()（未認証は /login へ）。全集計クエリは userId でフィルタし、
// クライアント入力 id は集計キーに一切使わない（§3-2 / §7.5）。
//
// 集計入口で当該ユーザーの running を materializeIfDue で確定し、確定漏れを回収してから集計する
// （§3-3・LAP-010 §10 申し送り）。materializeIfDue は冪等（due:false は書き込まない）。
// 純ロジック（UTC→JST 日割り・ゼロ埋め・移動平均・カウントダウン）は @/lib/aggregate に分離し、
// ここは I/O（Prisma クエリ + materialize）と描画の薄い層に徹する（§3-0）。
//
// requireUserId()（auth() で headers/cookies を読む）により動的レンダリングになるが、
// 堅牢性のため明示する（§3-3）。
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const user = await getCurrentUser(); // 表示用（email・admin バッジ）。
  const now = new Date();

  // 集計入口の確定漏れ回収（§3-3）。running は高々 1 件（partial unique index）。
  // due:true なら StudyRecord が新規生成され、後続の集計クエリが同一リクエストでそれを拾う。
  const running = await prisma.studySession.findFirst({
    where: { userId, status: "running" },
    select: {
      id: true,
      userId: true,
      topicId: true,
      presetSnapshot: true,
      startedAt: true,
    },
  });
  if (running) {
    await materializeIfDue(running, now);
  }

  // 期間窓（直近 HEATMAP_WINDOW_DAYS 日・今日 JST を含む両端）。
  const endKey = toJstDateKey(now);
  const startUtc = new Date(
    jstDateKeyToUtcStart(endKey).getTime() -
      (HEATMAP_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000,
  );
  const startKey = toJstDateKey(startUtc);
  const windowStart = jstDateKeyToUtcStart(startKey);

  // 集計クエリ（すべて userId 必須・§3-2）。
  const [topicSumsRaw, activeTopics, windowRecords, deadlineTopics] =
    await Promise.all([
      // (a) トピック別累計: アーカイブ除外（topic:{isArchived:false}）・全期間。@@index([userId,topicId])。
      prisma.studyRecord.groupBy({
        by: ["topicId"],
        where: { userId, topic: { isArchived: false } },
        _sum: { countedSeconds: true },
      }),
      // (b) 表示名 + 累計 0 トピックも一覧に残すためのアーカイブ外トピック。
      prisma.topic.findMany({
        where: { userId, isArchived: false },
        select: { id: true, title: true },
      }),
      // (c) ヒートマップ・移動平均: アーカイブ含む（isArchived 条件なし）・期間窓のみ。
      //     @@index([userId,completedAt]) の range が効く（§3-7）。
      prisma.studyRecord.findMany({
        where: { userId, completedAt: { gte: windowStart } },
        select: { completedAt: true, countedSeconds: true },
      }),
      // (d) 期限カウントダウン: アーカイブ外 + deadline 非 null のみ。@@index([userId,isArchived])。
      prisma.topic.findMany({
        where: { userId, isArchived: false, deadline: { not: null } },
        select: { id: true, title: true, deadline: true },
      }),
    ]);

  // 純関数整形（§3-4）。
  const topicSums: TopicSum[] = topicSumsRaw.map((g) => ({
    topicId: g.topicId,
    totalSeconds: g._sum.countedSeconds ?? 0,
  }));
  const topicTotals = joinTopicTotals(activeTopics, topicSums);

  const daily = fillDailySeries(bucketByJstDay(windowRecords), startKey, endKey);
  const ma = movingAverage(daily);

  // deadline:{not:null} で絞ったため deadline は非 null（型を Date に narrow）。
  const countdowns = computeDeadlineCountdowns(
    deadlineTopics.flatMap((t) =>
      t.deadline ? [{ id: t.id, title: t.title, deadline: t.deadline }] : [],
    ),
    now,
  );

  return (
    <main className="flex flex-col gap-8 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
        <LogoutButton />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          ログイン中: {user?.email}
          {user?.isAdmin ? "（管理者）" : ""}
        </p>
        <nav className="flex gap-3 text-sm">
          <Link
            href="/dashboard/sessions"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            ポモドーロ実行
          </Link>
          <Link
            href="/dashboard/topics"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            トピック
          </Link>
        </nav>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">トピック別の累計学習時間</h2>
        <p className="text-xs text-gray-500">
          アーカイブ済みトピックは除外しています（全期間の累計）。
        </p>
        <TopicTotalsChart totals={topicTotals} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          日別の学習量（直近 {HEATMAP_WINDOW_DAYS} 日）
        </h2>
        <p className="text-xs text-gray-500">
          トピック横断の総学習量（アーカイブ済みの過去記録も含む）。日境界は Asia/Tokyo。
        </p>
        <HeatmapChart daily={daily} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          7日移動平均（直近 {HEATMAP_WINDOW_DAYS} 日）
        </h2>
        <p className="text-xs text-gray-500">
          学習ゼロの日も 0 として含めた 7 日移動平均（先頭は部分平均）。
        </p>
        <MovingAverageChart points={ma} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">期限カウントダウン</h2>
        <p className="text-xs text-gray-500">
          期限を過ぎたトピックは警告表示します（自動アーカイブはしません）。
        </p>
        <CountdownList items={countdowns} />
      </section>
    </main>
  );
}
