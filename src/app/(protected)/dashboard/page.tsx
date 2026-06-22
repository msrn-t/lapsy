import { requireUserId } from "@/lib/auth-helpers";
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
  computeDashboardKpis,
  HEATMAP_WINDOW_DAYS,
  type TopicSum,
} from "@/lib/aggregate";
import {
  TopicTotalsChart,
  HeatmapChart,
  MovingAverageChart,
  CountdownList,
  formatHoursLabel,
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
  const [topicSumsRaw, activeTopics, windowRecords, deadlineTopics, totalAgg] =
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
      // (e・LAP-015 KPI) 総学習時間: 全 StudyRecord の SUM(countedSeconds)（アーカイブ含む全期間累計）。
      //     データ分離は where:{userId}（§7.5）。
      prisma.studyRecord.aggregate({
        where: { userId },
        _sum: { countedSeconds: true },
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

  // (e・LAP-015) サマリ KPI を純関数で導出（既存集計 + 総学習時間 aggregate から）。
  const kpis = computeDashboardKpis({
    totalSeconds: totalAgg._sum.countedSeconds ?? 0,
    daily,
    movingAverage: ma,
    activeTopicCount: activeTopics.length,
  });

  // 共通ヘッダ（タイトル / ユーザー / ナビ / ログアウト）は app shell（(protected)/layout.tsx）が
  // 提供するため、ここでは集計コンテンツのみを描画する（LAP-014 で重複導線を撤去）。
  // 外周余白は shell の content padding が担うため、ここでは縦の段組のみ。
  // 構造は WF 04: KPI cards c4 → ヒートマップ/移動平均 cards c2 → 累計バー/カウントダウン cards c2。
  return (
    <div className="flex flex-col gap-4">
      {/* サマリ KPI（WF .cards.c4・モバイル 2 列）。 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="総学習時間"
          value={formatHoursLabel(kpis.totalSeconds)}
          sub="全トピック累計"
        />
        <Kpi
          label="今日"
          value={formatHoursLabel(kpis.todaySeconds)}
          sub="Asia/Tokyo 基準"
        />
        <Kpi
          label="7日平均"
          value={formatHoursLabel(kpis.sevenDayAvgSeconds)}
          sub="移動平均"
        />
        <Kpi
          label="アクティブ"
          value={String(kpis.activeTopicCount)}
          sub="トピック数"
        />
      </div>

      {/* ヒートマップ + 7日移動平均（WF .cards.c2）。 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-card p-6">
          <p className="mb-2 font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
            学習ヒートマップ（日別・トピック横断・直近 {HEATMAP_WINDOW_DAYS} 日）
          </p>
          <HeatmapChart daily={daily} />
        </section>

        <section className="rounded-card border border-line bg-card p-6">
          <p className="mb-2 font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
            7日移動平均
          </p>
          <MovingAverageChart points={ma} />
          <p className="mt-1.5 text-[11px] text-ink-dim">
            学習ゼロの日も 0 で埋めて算出（先頭は部分平均）。
          </p>
        </section>
      </div>

      {/* トピック別累計バー + 期限カウントダウン（WF .cards.c2）。 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-card p-6">
          <p className="mb-3 font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
            トピック別 累計学習時間
          </p>
          <TopicTotalsChart totals={topicTotals} />
          <p className="mt-1.5 text-[11px] text-ink-dim">
            アーカイブ済みトピックは除外（全期間の累計）。
          </p>
        </section>

        <section className="rounded-card border border-line bg-card p-6">
          <p className="mb-2 font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
            期限カウントダウン
          </p>
          <CountdownList items={countdowns} />
        </section>
      </div>
    </div>
  );
}

// WF .kpi カード（k-label / k-val / k-sub）。
function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <div className="mb-1.5 text-[11px] text-ink-dim">{label}</div>
      <div className="font-[family-name:var(--font-fredoka)] text-[22px] font-semibold text-ink">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-ink-dim">{sub}</div>
    </div>
  );
}
