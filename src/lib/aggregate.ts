// ダッシュボード集計の純ロジック（LAP-011 §3-4 / SPEC §7.4 / §9）。DB 非依存。
// UTC `completedAt` → Asia/Tokyo 暦日変換・日次バケツ化・ゼロ埋め日次系列・7日移動平均・
// トピック別累計の突き合わせ・期限カウントダウンをすべて純関数として閉じ込め、
// `now`/オフセット/`window` を引数注入して時刻・サーバ TZ 非依存に単体テストする（aggregate.test.ts）。
//
// JST は DST が無いため固定 +9h オフセットを手動加算し、必ず getUTC* ゲッターで読む（§3-1）。
// getFullYear() 等のローカルゲッターはサーバ OS タイムゾーン依存になるため使わない。

/** Asia/Tokyo 固定オフセット（DST なし・§3-1）。 */
export const JST_OFFSET_MINUTES = 9 * 60;

/** ヒートマップ・移動平均の期間窓（今日 JST を含む直近 N 日・§3-7）。 */
export const HEATMAP_WINDOW_DAYS = 90;

/** 移動平均の窓（7 日・SPEC §4/§7.4）。 */
export const MOVING_AVERAGE_WINDOW = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * UTC Date を JST 暦日キー "YYYY-MM-DD" へ変換する（§3-1）。
 * +offsetMinutes ずらした Date を getUTC* で読むことでサーバ OS タイムゾーンに依存しない。
 */
export function toJstDateKey(
  date: Date,
  offsetMinutes: number = JST_OFFSET_MINUTES,
): string {
  const shifted = new Date(date.getTime() + offsetMinutes * MS_PER_MINUTE);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * JST 暦日キー "YYYY-MM-DD" を、その JST 0:00 を表す UTC Date へ戻す（期間窓の境界計算用・§3-7）。
 * JST 0:00 = UTC で前日 15:00（= Date.UTC(y,m-1,d) - 9h）。
 */
export function jstDateKeyToUtcStart(
  dateKey: string,
  offsetMinutes: number = JST_OFFSET_MINUTES,
): Date {
  const [y, m, d] = dateKey.split("-").map((s) => Number(s));
  // 当該 JST 暦日 0:00 を UTC ミリ秒へ。Date.UTC で「暦日の 0:00」を作り offset を引く。
  const utcMidnightMs = Date.UTC(y, m - 1, d);
  return new Date(utcMidnightMs - offsetMinutes * MS_PER_MINUTE);
}

/** "YYYY-MM-DD" 暦日キーを 1 日進める（連続日次系列の生成用・§3-4）。 */
function nextDateKey(dateKey: string): string {
  const start = jstDateKeyToUtcStart(dateKey);
  return toJstDateKey(new Date(start.getTime() + MS_PER_DAY));
}

/**
 * 2 つの JST 暦日キーの暦日差（later - earlier）を返す（§3-4）。
 * 両端を JST 0:00 の UTC Date に正規化し ms 差 / 86_400_000 を Math.round（DST なしのため厳密に整数）。
 */
function dateKeyDiffDays(earlierKey: string, laterKey: string): number {
  const a = jstDateKeyToUtcStart(earlierKey).getTime();
  const b = jstDateKeyToUtcStart(laterKey).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

export type StudyRecordLike = { completedAt: Date; countedSeconds: number };
export type DailyTotal = { dateKey: string; totalSeconds: number };

/**
 * StudyRecord 群を JST 暦日でバケツ化し countedSeconds を合算する（§7.2 status 不問・§7.4）。
 * 日跨ぎブロックは分割せず completedAt の JST 日に丸計上する（§7.4）。
 * 戻りは dateKey 昇順。学習のある日のみを含む（ゼロ埋めは fillDailySeries が行う）。
 */
export function bucketByJstDay(
  records: ReadonlyArray<StudyRecordLike>,
  offsetMinutes: number = JST_OFFSET_MINUTES,
): DailyTotal[] {
  const sums = new Map<string, number>();
  for (const r of records) {
    const key = toJstDateKey(r.completedAt, offsetMinutes);
    sums.set(key, (sums.get(key) ?? 0) + r.countedSeconds);
  }
  return [...sums.entries()]
    .map(([dateKey, totalSeconds]) => ({ dateKey, totalSeconds }))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

/**
 * 日次系列を [startKey, endKey]（両端含む・JST 暦日）で連続化し、
 * 学習ゼロの日を totalSeconds=0 で埋める（§7.4）。戻りは dateKey 昇順・欠損なし。
 * end は通常「今日（JST）」、start は end から windowDays-1 日前（§3-7）。
 * 範囲外の totals は無視する。
 */
export function fillDailySeries(
  totals: ReadonlyArray<DailyTotal>,
  startKey: string,
  endKey: string,
): DailyTotal[] {
  const byKey = new Map<string, number>();
  for (const t of totals) {
    byKey.set(t.dateKey, t.totalSeconds);
  }

  const out: DailyTotal[] = [];
  let key = startKey;
  // 両端含む。start > end の場合は空配列（防御）。
  while (dateKeyDiffDays(key, endKey) >= 0) {
    out.push({ dateKey: key, totalSeconds: byKey.get(key) ?? 0 });
    if (key === endKey) break;
    key = nextDateKey(key);
  }
  return out;
}

export type MovingAveragePoint = { dateKey: string; averageSeconds: number };

/**
 * ゼロ埋め済み連続日次系列に対し 7 日移動平均を算出する（§7.4・裁量 #4）。
 * - 各日 i の平均 = 直近 min(i+1, window) 日の totalSeconds 平均（後方移動平均）。
 * - 系列が window 未満の期間は存在する日数での部分平均（先頭ほど少ない日数で割る・SPEC §4）。
 * - 入力はゼロ埋め済み連続系列を前提（呼び出し側が fillDailySeries を通す）。
 * 戻りは入力と同じ長さ・同じ dateKey 順。
 */
export function movingAverage(
  series: ReadonlyArray<DailyTotal>,
  window: number = MOVING_AVERAGE_WINDOW,
): MovingAveragePoint[] {
  const out: MovingAveragePoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const from = Math.max(0, i - window + 1);
    const count = i - from + 1;
    let sum = 0;
    for (let j = from; j <= i; j++) {
      sum += series[j].totalSeconds;
    }
    out.push({ dateKey: series[i].dateKey, averageSeconds: sum / count });
  }
  return out;
}

export type TopicTotalInput = { id: string; title: string }; // isArchived:false のトピック
export type TopicSum = { topicId: string; totalSeconds: number }; // groupBy 結果
export type TopicTotal = { topicId: string; title: string; totalSeconds: number };

/**
 * アーカイブ外トピック一覧と groupBy 合算を突き合わせる（§3-2）。
 * 記録のないトピックは totalSeconds=0 で含める。totalSeconds 降順 → title 昇順で安定ソート。
 */
export function joinTopicTotals(
  topics: ReadonlyArray<TopicTotalInput>,
  sums: ReadonlyArray<TopicSum>,
): TopicTotal[] {
  const byTopic = new Map<string, number>();
  for (const s of sums) {
    byTopic.set(s.topicId, s.totalSeconds);
  }
  return topics
    .map((t) => ({
      topicId: t.id,
      title: t.title,
      totalSeconds: byTopic.get(t.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
}

// ── ダッシュボード KPI（LAP-015 (a)・WF 04 KPI 4 枚）──
// 総学習時間（全期間累計）/ 今日（daily 末尾日）/ 7 日平均（ma 末尾点）/ アクティブトピック数 を
// 既存集計（fillDailySeries 済み daily・movingAverage 済み ma）＋ aggregate 由来の総学習時間から導出する。
// DB 非依存（page.tsx が userId フィルタで取得した値を注入）・空入力は 0 を返す（防御）。

export type DashboardKpis = {
  totalSeconds: number; // 全期間累計（aggregate から注入）
  todaySeconds: number; // daily 末尾日（= 今日 JST）の合計
  sevenDayAvgSeconds: number; // ma 末尾点の averageSeconds
  activeTopicCount: number; // アーカイブ外トピック数
};

/**
 * ダッシュボードのサマリ KPI を算出する純関数（§3-4 / LAP-015 (a)）。
 * - todaySeconds = daily の末尾要素（昇順前提なので末尾＝今日 JST）の totalSeconds。空なら 0。
 * - sevenDayAvgSeconds = movingAverage の末尾点 averageSeconds。空なら 0。
 * - totalSeconds / activeTopicCount は呼び出し側（aggregate / topic.findMany）の値をそのまま採る。
 *   負値は 0 へクランプ（防御）。
 */
export function computeDashboardKpis(input: {
  totalSeconds: number;
  daily: ReadonlyArray<DailyTotal>;
  movingAverage: ReadonlyArray<MovingAveragePoint>;
  activeTopicCount: number;
}): DashboardKpis {
  const todaySeconds =
    input.daily.length > 0 ? input.daily[input.daily.length - 1].totalSeconds : 0;
  const sevenDayAvgSeconds =
    input.movingAverage.length > 0
      ? input.movingAverage[input.movingAverage.length - 1].averageSeconds
      : 0;
  const clamp = (n: number) => (n > 0 ? n : 0);
  return {
    totalSeconds: clamp(input.totalSeconds),
    todaySeconds: clamp(todaySeconds),
    sevenDayAvgSeconds: clamp(sevenDayAvgSeconds),
    activeTopicCount: clamp(input.activeTopicCount),
  };
}

export type DeadlineInput = { id: string; title: string; deadline: Date };
export type DeadlineCountdown = {
  id: string;
  title: string;
  deadline: Date;
  daysRemaining: number; // JST 暦日差。今日=0、明日=1、昨日=-1
  isOverdue: boolean; // daysRemaining < 0（§3-5・期限超過）
};

/**
 * 各トピックの期限日までの JST 暦日差を算出する（裁量 #5・SPEC §4/Should）。
 * daysRemaining = (deadline の JST 暦日) - (now の JST 暦日)（暦日単位の差・時刻は無視）。
 * isOverdue = daysRemaining < 0。自動アーカイブはしない（§3-5）。
 * 戻りは daysRemaining 昇順（期限が近い/超過が先頭）。同値は title 昇順で安定。
 */
export function computeDeadlineCountdowns(
  topics: ReadonlyArray<DeadlineInput>,
  now: Date,
  offsetMinutes: number = JST_OFFSET_MINUTES,
): DeadlineCountdown[] {
  const nowKey = toJstDateKey(now, offsetMinutes);
  return topics
    .map((t) => {
      const deadlineKey = toJstDateKey(t.deadline, offsetMinutes);
      const daysRemaining = dateKeyDiffDays(nowKey, deadlineKey);
      return {
        id: t.id,
        title: t.title,
        deadline: t.deadline,
        daysRemaining,
        isOverdue: daysRemaining < 0,
      };
    })
    .sort((a, b) => {
      if (a.daysRemaining !== b.daysRemaining)
        return a.daysRemaining - b.daysRemaining;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
}
