// ダッシュボードの可視化 presentational コンポーネント（LAP-011 §3-6 / LAP-015 WF 04 整合）。
// グラフライブラリは導入せず SVG/CSS（Tailwind）で自作する。
// データ整形は純関数（@/lib/aggregate）で完結済み。ここは props を受けて描画するのみ
// （DB/集計ロジックは持ち込まない）。
// LAP-015: WF 04 のグレースケール単色トークン（bg-line-strong / WF heatmap グレー段階）へ整合し、
// 有彩色（blue-*/green-*）と dark:* を撤去した。ロジック（段階判定・座標計算）は不変。

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

// 秒を WF KPI 風の "Nh" / "N.Nh" / "N分" 表記へ整形（KPI カード用・LAP-015 (a)）。
// 1 時間以上は時間（小数 1 桁・端数 0 は整数）、1 時間未満は分で表示する。
export function formatHoursLabel(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0h";
  const hours = totalSeconds / 3600;
  if (hours >= 1) {
    const rounded = Math.round(hours * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
  }
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes}分`;
}

// "YYYY-MM-DD" を "M/D" へ（軸・ツールチップの短縮表示）。
function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// ── トピック別累計（水平バー・§3-6 / WF .bar-row）──
export function TopicTotalsChart({ totals }: { totals: TopicTotal[] }) {
  if (totals.length === 0) {
    return (
      <p className="text-sm text-ink-dim">
        まだ学習トピックがありません。先にトピックを作成して学習を記録してください。
      </p>
    );
  }
  const max = Math.max(1, ...totals.map((t) => t.totalSeconds));

  return (
    <ul className="flex flex-col gap-2.5">
      {totals.map((t) => {
        const pct = (t.totalSeconds / max) * 100;
        return (
          <li key={t.topicId} className="flex items-center gap-3 text-xs">
            <span className="w-28 shrink-0 truncate text-ink">{t.title}</span>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-[#E6E6E6]">
              <div
                className="h-full bg-line-strong"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums text-ink-dim">
              {formatHm(t.totalSeconds)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── 日別ヒートマップ（週グリッド・GitHub 風・§3-6 / WF .heat グレー段階）──
// daily は JST 暦日昇順・連続（fillDailySeries 済み）を前提。
// 列=週、行=曜日（0=日 .. 6=土）。各セルの濃淡を totalSeconds の段階で塗り分ける。
// WF の段階色（#E6E6E6 / #D2D2D2 / #B4B4B4 / #979797 / #7C7C7C）へ整合。
const HEAT_STEPS: { max: number; bg: string; label: string }[] = [
  { max: 0, bg: "#E6E6E6", label: "なし" },
  { max: 30 * 60, bg: "#D2D2D2", label: "〜30分" },
  { max: 60 * 60, bg: "#B4B4B4", label: "〜1時間" },
  { max: 120 * 60, bg: "#979797", label: "〜2時間" },
  { max: Infinity, bg: "#7C7C7C", label: "2時間以上" },
];

function heatBg(totalSeconds: number): string {
  for (const step of HEAT_STEPS) {
    if (totalSeconds <= step.max) return step.bg;
  }
  return HEAT_STEPS[HEAT_STEPS.length - 1].bg;
}

// JST 暦日キーの曜日（0=日..6=土）。UTC 前日 15:00 を getUTCDay で読む（サーバ TZ 非依存）。
function jstWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map((s) => Number(s));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function HeatmapChart({ daily }: { daily: DailyTotal[] }) {
  if (daily.length === 0) {
    return <p className="text-sm text-ink-dim">表示できる学習記録がありません。</p>;
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
                className="flex h-3.5 items-center text-[10px] leading-none text-ink-dim"
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
                      className="h-3.5 w-3.5 rounded-sm"
                      style={{ background: heatBg(cell.totalSeconds) }}
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
      <div className="flex items-center gap-1.5 text-[10px] text-ink-dim">
        <span>少</span>
        {HEAT_STEPS.map((s) => (
          <span
            key={s.label}
            className="h-3 w-3 rounded-sm"
            style={{ background: s.bg }}
            title={s.label}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

// ── 7日移動平均（SVG 折れ線・§3-6 / WF グレー線）──
export function MovingAverageChart({ points }: { points: MovingAveragePoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-ink-dim">表示できる学習記録がありません。</p>;
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
          stroke="var(--color-line)"
          strokeWidth={1}
        />
        <text x={4} y={PAD.top + 4} className="fill-ink-dim text-[10px]">
          {maxMin}分
        </text>
        <text x={4} y={PAD.top + innerH} className="fill-ink-dim text-[10px]">
          0分
        </text>
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* x 軸の開始/終了ラベル */}
        <text x={PAD.left} y={H - 6} className="fill-ink-dim text-[10px]">
          {shortDate(points[0].dateKey)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          className="fill-ink-dim text-[10px]"
        >
          {shortDate(points[n - 1].dateKey)}
        </text>
      </svg>
    </div>
  );
}

// ── 期限カウントダウン（行リスト・§3-5 / WF .dl-row）──
export function CountdownList({ items }: { items: DeadlineCountdown[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-dim">
        期限の設定された学習トピックはありません。
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {items.map((it) => {
        const deadlineKey = toJstDateKey(it.deadline);
        // WF .dl-days は D-14 / +3 表記（残り日数 / 超過日数）。
        const daysLabel = it.isOverdue
          ? `+${Math.abs(it.daysRemaining)}`
          : `D-${it.daysRemaining}`;
        return (
          <li
            key={it.id}
            className="flex items-center gap-3 border-b border-line py-2.5 text-xs last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 truncate text-ink">
                {it.title}
                {it.isOverdue ? (
                  <span className="inline-block rounded-full border border-dashed border-error px-2 py-0.5 text-[10px] text-error">
                    期限超過
                  </span>
                ) : null}
              </span>
              <span className="text-[11px] text-ink-dim">期限: {deadlineKey}</span>
            </div>
            <span
              className={
                it.isOverdue
                  ? "font-[family-name:var(--font-fredoka)] text-base font-semibold text-error"
                  : "font-[family-name:var(--font-fredoka)] text-base font-semibold text-ink"
              }
            >
              {daysLabel}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
