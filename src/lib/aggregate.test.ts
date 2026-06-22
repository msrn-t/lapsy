import { describe, it, expect } from "vitest";
import {
  toJstDateKey,
  jstDateKeyToUtcStart,
  bucketByJstDay,
  fillDailySeries,
  movingAverage,
  joinTopicTotals,
  computeDeadlineCountdowns,
  type StudyRecordLike,
} from "./aggregate";

// LAP-011 §9-1 のテスト対象。DB 非依存・Date/オフセット/now を固定注入（時刻・サーバ TZ 非依存）。
// completedAt は UTC Date を直接渡す。materializeIfDue 接続・DB クエリ・SVG 描画は対象外
// （reviewer が dashboard/page.tsx の接続・where 条件を読みで確認）。

// JST 0:00 = UTC 前日 15:00 を基準に境界を組む。

describe("toJstDateKey / jstDateKeyToUtcStart（UTC→JST 暦日変換・§3-1）", () => {
  it("T-TZ-MIDDAY: 03:00Z（JST 12:00）→ 同日", () => {
    expect(toJstDateKey(new Date("2026-06-22T03:00:00.000Z"))).toBe("2026-06-22");
  });

  it("T-TZ-BOUNDARY: 15:00Z は JST 翌 0:00 / 14:59:59Z は JST 当日 23:59:59", () => {
    expect(toJstDateKey(new Date("2026-06-22T15:00:00.000Z"))).toBe("2026-06-23");
    expect(toJstDateKey(new Date("2026-06-22T14:59:59.000Z"))).toBe("2026-06-22");
  });

  it("T-TZ-YEAR: 2026-12-31T15:00:00Z → 2027-01-01（年跨ぎ）", () => {
    expect(toJstDateKey(new Date("2026-12-31T15:00:00.000Z"))).toBe("2027-01-01");
  });

  it("T-TZ-ROUNDTRIP: jstDateKeyToUtcStart → toJstDateKey で入力 key に戻る", () => {
    const key = "2026-06-22";
    const utc = jstDateKeyToUtcStart(key);
    // JST 0:00 = UTC 前日 15:00。
    expect(utc.toISOString()).toBe("2026-06-21T15:00:00.000Z");
    expect(toJstDateKey(utc)).toBe(key);
  });
});

describe("bucketByJstDay（JST 日割り・status 不問の合算・§7.2 / §7.4）", () => {
  it("T-BUCKET-SUM: 同一 JST 日の completed+aborted 混在を合算（status 不問）", () => {
    const records: StudyRecordLike[] = [
      { completedAt: new Date("2026-06-22T01:00:00.000Z"), countedSeconds: 1500 }, // JST 6-22 10:00
      { completedAt: new Date("2026-06-22T05:00:00.000Z"), countedSeconds: 600 }, // JST 6-22 14:00
    ];
    const out = bucketByJstDay(records);
    expect(out).toEqual([{ dateKey: "2026-06-22", totalSeconds: 2100 }]);
  });

  it("T-BUCKET-MULTIDAY: 異なる JST 日は dateKey 昇順で各日合算（学習のある日のみ）", () => {
    const records: StudyRecordLike[] = [
      { completedAt: new Date("2026-06-23T02:00:00.000Z"), countedSeconds: 300 }, // 6-23
      { completedAt: new Date("2026-06-22T02:00:00.000Z"), countedSeconds: 100 }, // 6-22
      { completedAt: new Date("2026-06-22T03:00:00.000Z"), countedSeconds: 200 }, // 6-22
    ];
    const out = bucketByJstDay(records);
    expect(out).toEqual([
      { dateKey: "2026-06-22", totalSeconds: 300 },
      { dateKey: "2026-06-23", totalSeconds: 300 },
    ]);
  });

  it("T-CROSSDAY: completedAt=2026-06-22T15:30:00Z（JST 翌 0:30）→ 6-23 へ丸計上（分割しない）", () => {
    const records: StudyRecordLike[] = [
      { completedAt: new Date("2026-06-22T15:30:00.000Z"), countedSeconds: 3000 },
    ];
    const out = bucketByJstDay(records);
    expect(out).toEqual([{ dateKey: "2026-06-23", totalSeconds: 3000 }]);
  });

  it("空入力は空配列", () => {
    expect(bucketByJstDay([])).toEqual([]);
  });
});

describe("fillDailySeries（ゼロ埋め連続系列・§7.4）", () => {
  it("T-FILL-ZERO: [{6-22:600}] を 6-20..6-23 で埋める → 6-20/21/23 は 0", () => {
    const out = fillDailySeries(
      [{ dateKey: "2026-06-22", totalSeconds: 600 }],
      "2026-06-20",
      "2026-06-23",
    );
    expect(out).toEqual([
      { dateKey: "2026-06-20", totalSeconds: 0 },
      { dateKey: "2026-06-21", totalSeconds: 0 },
      { dateKey: "2026-06-22", totalSeconds: 600 },
      { dateKey: "2026-06-23", totalSeconds: 0 },
    ]);
  });

  it("単日範囲（start=end）は 1 要素", () => {
    expect(
      fillDailySeries([], "2026-06-22", "2026-06-22"),
    ).toEqual([{ dateKey: "2026-06-22", totalSeconds: 0 }]);
  });

  it("月跨ぎでも連続する", () => {
    const out = fillDailySeries([], "2026-06-29", "2026-07-02");
    expect(out.map((d) => d.dateKey)).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
    ]);
  });
});

describe("movingAverage（7日移動平均・ゼロ埋め・部分平均・§7.4）", () => {
  it("T-MA-FULL: ゼロ埋め済み 8 日系列・window=7 → 8 日目は [2..8] の平均", () => {
    // totalSeconds = 各日 i (1始まり) を 60*i にする → 60,120,...,480
    const series = Array.from({ length: 8 }, (_, i) => ({
      dateKey: `2026-06-${String(20 + i).padStart(2, "0")}`,
      totalSeconds: 60 * (i + 1),
    }));
    const ma = movingAverage(series, 7);
    expect(ma).toHaveLength(8);
    // 1 日目 = 60 / 1（部分平均）。
    expect(ma[0].averageSeconds).toBe(60);
    // 7 日目 = (60+...+420)/7 = 240。
    expect(ma[6].averageSeconds).toBe(240);
    // 8 日目 = (120+...+480)/7 = 300（直近 7 日窓・先頭の 60 が落ちる）。
    expect(ma[7].averageSeconds).toBe(300);
  });

  it("T-MA-PARTIAL: 3 日系列（<7）は実日数で割る部分平均", () => {
    const series = [
      { dateKey: "2026-06-20", totalSeconds: 300 },
      { dateKey: "2026-06-21", totalSeconds: 900 },
      { dateKey: "2026-06-22", totalSeconds: 600 },
    ];
    const ma = movingAverage(series, 7);
    expect(ma[0].averageSeconds).toBe(300); // 300/1
    expect(ma[1].averageSeconds).toBe(600); // (300+900)/2
    expect(ma[2].averageSeconds).toBe(600); // (300+900+600)/3
  });

  it("T-MA-ZEROFILL: ゼロ日も分母に含めて平均（過大表示しない）", () => {
    const series = [
      { dateKey: "2026-06-20", totalSeconds: 0 },
      { dateKey: "2026-06-21", totalSeconds: 600 },
      { dateKey: "2026-06-22", totalSeconds: 0 },
    ];
    const ma = movingAverage(series, 7);
    expect(ma[0].averageSeconds).toBe(0); // 0/1
    expect(ma[1].averageSeconds).toBe(300); // (0+600)/2
    expect(ma[2].averageSeconds).toBe(200); // (0+600+0)/3 — ゼロ日も分母
  });

  it("空系列は空配列", () => {
    expect(movingAverage([])).toEqual([]);
  });
});

describe("joinTopicTotals（トピック別累計の突き合わせ・§3-2）", () => {
  it("T-JOIN-ZERO: 記録なしトピックは 0 で含める。total desc → title asc", () => {
    const out = joinTopicTotals(
      [
        { id: "A", title: "Algebra" },
        { id: "B", title: "Biology" },
      ],
      [{ topicId: "A", totalSeconds: 1200 }],
    );
    expect(out).toEqual([
      { topicId: "A", title: "Algebra", totalSeconds: 1200 },
      { topicId: "B", title: "Biology", totalSeconds: 0 },
    ]);
  });

  it("T-JOIN-SORT: totalSeconds 降順・同値は title 昇順で安定", () => {
    const out = joinTopicTotals(
      [
        { id: "A", title: "Zeta" },
        { id: "B", title: "Beta" },
        { id: "C", title: "Alpha" },
      ],
      [
        { topicId: "A", totalSeconds: 100 },
        { topicId: "B", totalSeconds: 100 },
        { topicId: "C", totalSeconds: 500 },
      ],
    );
    expect(out.map((t) => t.topicId)).toEqual(["C", "B", "A"]); // 500, (100 Beta), (100 Zeta)
  });

  it("groupBy にあるがアーカイブ済みで topics に無い topicId は無視される", () => {
    const out = joinTopicTotals(
      [{ id: "A", title: "Active" }],
      [
        { topicId: "A", totalSeconds: 60 },
        { topicId: "ARCHIVED", totalSeconds: 9999 },
      ],
    );
    expect(out).toEqual([{ topicId: "A", title: "Active", totalSeconds: 60 }]);
  });
});

describe("computeDeadlineCountdowns（JST 暦日差・期限超過・§3-5）", () => {
  const now = new Date("2026-06-22T03:00:00.000Z"); // JST 6-22 12:00

  it("T-COUNTDOWN-TODAY: deadline=今日 JST → daysRemaining=0, isOverdue=false", () => {
    const out = computeDeadlineCountdowns(
      [{ id: "T", title: "Today", deadline: new Date("2026-06-22T08:00:00.000Z") }], // JST 6-22 17:00
      now,
    );
    expect(out[0]).toMatchObject({ daysRemaining: 0, isOverdue: false });
  });

  it("T-COUNTDOWN-FUTURE: deadline=3 日後 → daysRemaining=3, isOverdue=false", () => {
    const out = computeDeadlineCountdowns(
      [{ id: "T", title: "Future", deadline: new Date("2026-06-25T01:00:00.000Z") }], // JST 6-25
      now,
    );
    expect(out[0]).toMatchObject({ daysRemaining: 3, isOverdue: false });
  });

  it("T-COUNTDOWN-OVERDUE: deadline=昨日 → daysRemaining=-1, isOverdue=true", () => {
    const out = computeDeadlineCountdowns(
      [{ id: "T", title: "Past", deadline: new Date("2026-06-21T10:00:00.000Z") }], // JST 6-21
      now,
    );
    expect(out[0]).toMatchObject({ daysRemaining: -1, isOverdue: true });
  });

  it("T-COUNTDOWN-TZ: UTC では同日だが JST 暦日が異なる境界を暦日差で判定", () => {
    // now=2026-06-22T20:00:00Z は JST 6-23 05:00。deadline=2026-06-22T22:00:00Z は JST 6-23 07:00。
    // UTC では同日(6-22)だが JST では両者 6-23 → 暦日差 0。
    const nowLate = new Date("2026-06-22T20:00:00.000Z");
    const out = computeDeadlineCountdowns(
      [
        {
          id: "T",
          title: "Edge",
          deadline: new Date("2026-06-22T22:00:00.000Z"),
        },
      ],
      nowLate,
    );
    expect(out[0]).toMatchObject({ daysRemaining: 0, isOverdue: false });
  });

  it("T-COUNTDOWN-SORT: daysRemaining 昇順（超過・近い順が先頭）", () => {
    const out = computeDeadlineCountdowns(
      [
        { id: "F", title: "Future", deadline: new Date("2026-06-25T01:00:00.000Z") }, // +3
        { id: "O", title: "Overdue", deadline: new Date("2026-06-20T01:00:00.000Z") }, // -2
        { id: "T", title: "Today", deadline: new Date("2026-06-22T01:00:00.000Z") }, // 0
      ],
      now,
    );
    expect(out.map((d) => d.id)).toEqual(["O", "T", "F"]);
  });

  it("空入力は空配列", () => {
    expect(computeDeadlineCountdowns([], now)).toEqual([]);
  });

  // LAP-013: CountdownList の期限日ラベルは toJstDateKey(deadline) で算出される。
  // ラベルと daysRemaining/isOverdue が同一純関数（同一 JST 暦日基準）を共有することで、
  // UTC 夕方〜夜の deadline（再現値 16:00Z = JST 翌日）でも両者がズレないことを純関数レベルで担保する。
  it("T-COUNTDOWN-LABEL-TZ(LAP-013): 16:00Z deadline のラベルと残り日数が同一 JST 暦日基準で整合", () => {
    const deadline = new Date("2026-06-30T16:00:00.000Z"); // UTC 6-30 夜 = JST 7-01 01:00
    // ラベル側: _charts.tsx が使うのと同一の toJstDateKey で JST 暦日へ変換 → UTC 当日(6-30)ではなく JST の 7-01。
    expect(toJstDateKey(deadline)).toBe("2026-07-01");
    // UTC の単純切り出し（旧バグ）なら 6-30 となりラベルがズレる。
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-06-30");

    // 残り日数側: now=JST 6-30 12:00 基準で daysRemaining=1（JST 暦日差 7-01 − 6-30）。
    const nowJst = new Date("2026-06-30T03:00:00.000Z"); // JST 6-30 12:00
    const out = computeDeadlineCountdowns(
      [{ id: "L13", title: "JST Edge", deadline }],
      nowJst,
    );
    expect(out[0]).toMatchObject({ daysRemaining: 1, isOverdue: false });
    // ラベル(JST 7-01)と残り日数(JST 暦日差=1)が同一 JST 基準で一致 → 表示の内部不整合なし。
  });
});
