// ダッシュボードの可視化 presentational コンポーネント（LAP-011 §3-6）。
// グラフライブラリは導入せず SVG/CSS（Tailwind）で自作する。
// データ整形は純関数（@/lib/aggregate）で完結済み。ここは props を受けて描画するのみ
// （DB/集計ロジックは持ち込まない）。

import type {
  DailyTotal,
  MovingAveragePoint,
  TopicTotal,
  DeadlineCountdown,
} from "@/lib/aggregate";
import { toJstDateKey } from "@/lib/aggregate";

// 秒を「H時間M分」/「M分」へ整形（表示用）。
function formatHm(totalSeconds: number): string {
  const totalMin = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

// "YYYY-MM-DD" を "M/D" へ（軸・ツールチップの短縮表示）。
function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// ── トピック別累計（水平バー・§3-6）──
export function TopicTotalsChart({ totals }: { totals: TopicTotal[] }) {
  if (totals.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        まだ学習トピックがありません。先にトピックを作成して学習を記録してください。
      </p>
    );
  }
  const max = Math.max(1, ...totals.map((t) => t.totalSeconds));

  return (
    <ul className="flex flex-col gap-2">
      {totals.map((t) => {
        const pct = (t.totalSeconds / max) * 100;
        return (
          <li key={t.topicId} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{t.title}</span>
              <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
                {formatHm(t.totalSeconds)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full rounded bg-blue-500 dark:bg-blue-600"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── 日別ヒートマップ（週グリッド・GitHub 風・§3-6）──
// daily は JST 暦日昇順・連続（fillDailySeries 済み）を前提。
// 列=週、行=曜日（0=日 .. 6=土）。各セルの濃淡を totalSeconds の段階で塗り分ける。
const HEAT_STEPS: { max: number; cls: string; label: string }[] = [
  { max: 0, cls: "bg-gray-100 dark:bg-gray-800", label: "なし" },
  { max: 30 * 60, cls: "bg-green-200 dark:bg-green-900", label: "〜30分" },
  { max: 60 * 60, cls: "bg-green-300 dark:bg-green-700", label: "〜1時間" },
  { max: 120 * 60, cls: "bg-green-500 dark:bg-green-600", label: "〜2時間" },
  { max: Infinity, cls: "bg-green-700 dark:bg-green-400", label: "2時間以上" },
];

function heatClass(totalSeconds: number): string {
  for (const step of HEAT_STEPS) {
    if (totalSeconds <= step.max) return step.cls;
  }
  return HEAT_STEPS[HEAT_STEPS.length - 1].cls;
}

// JST 暦日キーの曜日（0=日..6=土）。UTC 前日 15:00 を getUTCDay で読む（サーバ TZ 非依存）。
function jstWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map((s) => Number(s));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function HeatmapChart({ daily }: { daily: DailyTotal[] }) {
  if (daily.length === 0) {
    return <p className="text-sm text-gray-500">表示できる学習記録がありません。</p>;
  }

  // 先頭日の曜日に合わせて週の先頭（日曜）まで空セルを詰める。
  const lead = jstWeekday(daily[0].dateKey);
  type Cell = DailyTotal | null;
  const cells: Cell[] = [...Array<Cell>(lead).fill(null), ...daily];
  // 7 で割り切れるよう末尾も詰める。
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = cells.length / 7;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <div className="flex gap-2">
          {/* 曜日ラベル列 */}
          <div className="grid grid-rows-7 gap-1 pt-0">
            {WEEKDAY_LABELS.map((w, i) => (
              <span
                key={w}
                className="flex h-3.5 items-center text-[10px] leading-none text-gray-400"
              >
                {i % 2 === 1 ? w : ""}
              </span>
            ))}
          </div>
          {/* 週ごとの列 */}
          <div className="flex gap-1">
            {Array.from({ length: weeks }, (_, wi) => (
              <div key={wi} className="grid grid-rows-7 gap-1">
                {Array.from({ length: 7 }, (_, di) => {
                  const cell = cells[wi * 7 + di];
                  if (!cell) {
                    return <span key={di} className="h-3.5 w-3.5" />;
                  }
                  return (
                    <span
                      key={di}
                      className={`h-3.5 w-3.5 rounded-sm ${heatClass(cell.totalSeconds)}`}
                      title={`${cell.dateKey}: ${formatHm(cell.totalSeconds)}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 凡例 */}
      <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
        <span>少</span>
        {HEAT_STEPS.map((s) => (
          <span key={s.label} className={`h-3 w-3 rounded-sm ${s.cls}`} title={s.label} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

// ── 7日移動平均（SVG 折れ線・§3-6）──
export function MovingAverageChart({ points }: { points: MovingAveragePoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-gray-500">表示できる学習記録がありません。</p>;
  }

  const W = 720;
  const H = 160;
  const PAD = { top: 12, right: 12, bottom: 22, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxSec = Math.max(1, ...points.map((p) => p.averageSeconds));
  const n = points.length;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (sec: number) => PAD.top + innerH - (sec / maxSec) * innerH;

  const polyline = points.map((p, i) => `${x(i)},${y(p.averageSeconds)}`).join(" ");
  const maxMin = Math.round(maxSec / 60);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full min-w-[480px]"
        role="img"
        aria-label="7日移動平均の推移"
      >
        {/* y 軸の上限ラベル + ベースライン */}
        <line
          x1={PAD.left}
          y1={PAD.top + innerH}
          x2={W - PAD.right}
          y2={PAD.top + innerH}
          className="stroke-gray-200 dark:stroke-gray-700"
          strokeWidth={1}
        />
        <text x={4} y={PAD.top + 4} className="fill-gray-400 text-[10px]">
          {maxMin}分
        </text>
        <text x={4} y={PAD.top + innerH} className="fill-gray-400 text-[10px]">
          0分
        </text>
        <polyline
          points={polyline}
          fill="none"
          className="stroke-blue-500 dark:stroke-blue-400"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* x 軸の開始/終了ラベル */}
        <text x={PAD.left} y={H - 6} className="fill-gray-400 text-[10px]">
          {shortDate(points[0].dateKey)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          className="fill-gray-400 text-[10px]"
        >
          {shortDate(points[n - 1].dateKey)}
        </text>
      </svg>
    </div>
  );
}

// ── 期限カウントダウン（カード/行リスト・§3-5）──
export function CountdownList({ items }: { items: DeadlineCountdown[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        期限の設定された学習トピックはありません。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => {
        const deadlineKey = toJstDateKey(it.deadline);
        const label = it.isOverdue
          ? `${Math.abs(it.daysRemaining)}日超過`
          : it.daysRemaining === 0
            ? "本日が期限"
            : `残り${it.daysRemaining}日`;
        return (
          <li
            key={it.id}
            className={
              it.isOverdue
                ? "flex items-center justify-between gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-800 dark:bg-red-950"
                : "flex items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
            }
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{it.title}</span>
              <span className="text-xs text-gray-500">期限: {deadlineKey}</span>
            </div>
            <span
              className={
                it.isOverdue
                  ? "shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900 dark:text-red-300"
                  : "shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }
            >
              {it.isOverdue ? `期限超過（${label}）` : label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
