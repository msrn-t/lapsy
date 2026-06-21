import { describe, it, expect } from "vitest";
import {
  validateTopicInput,
  evaluateTopicDeletion,
  MAX_TITLE_LENGTH,
} from "./topic";

// LAP-006 §9 のテスト対象。純関数 validateTopicInput / evaluateTopicDeletion を
// 検証する。入力検証・正規化（trim / 空文字→null / deadline パース）と、
// 削除可否判定（running > 記録あり > 削除可 の優先順位）を網羅する。

describe("validateTopicInput（トピック入力検証・正規化）", () => {
  it("タイトルが空文字なら title_required", () => {
    expect(validateTopicInput({ title: "" })).toEqual({
      ok: false,
      reason: "title_required",
    });
  });

  it("タイトルが空白のみ（trim 後 0 文字）なら title_required", () => {
    expect(validateTopicInput({ title: "   \t\n " })).toEqual({
      ok: false,
      reason: "title_required",
    });
  });

  it("タイトルが上限ちょうどなら ok（境界）", () => {
    const title = "a".repeat(MAX_TITLE_LENGTH);
    const result = validateTopicInput({ title });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe(title);
    }
  });

  it("タイトルが上限超過なら title_too_long（trim 後の長さで判定）", () => {
    // 前後に空白を付けても trim 後の本体が超過していれば拒否される。
    const title = `  ${"a".repeat(MAX_TITLE_LENGTH + 1)}  `;
    expect(validateTopicInput({ title })).toEqual({
      ok: false,
      reason: "title_too_long",
    });
  });

  it("有効入力で title を trim し description は null 正規化（未指定）", () => {
    const result = validateTopicInput({ title: "  数学  " });
    expect(result).toEqual({
      ok: true,
      value: { title: "数学", description: null, deadline: null },
    });
  });

  it("description が空白のみなら null へ正規化", () => {
    const result = validateTopicInput({ title: "英語", description: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeNull();
  });

  it("description が空文字なら null へ正規化", () => {
    const result = validateTopicInput({ title: "英語", description: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeNull();
  });

  it("description は trim して保持する", () => {
    const result = validateTopicInput({
      title: "英語",
      description: "  単語暗記  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBe("単語暗記");
  });

  it("description が null でも ok（null → null）", () => {
    const result = validateTopicInput({ title: "英語", description: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeNull();
  });

  it("deadline が空文字なら null へ正規化", () => {
    const result = validateTopicInput({ title: "化学", deadline: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.deadline).toBeNull();
  });

  it("deadline が有効な日付文字列なら Date へ変換", () => {
    const result = validateTopicInput({ title: "化学", deadline: "2026-12-31" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deadline).toBeInstanceOf(Date);
      expect(result.value.deadline?.getTime()).toBe(
        new Date("2026-12-31").getTime(),
      );
    }
  });

  it("deadline が不正な文字列なら invalid_deadline（DB に渡さない）", () => {
    expect(
      validateTopicInput({ title: "化学", deadline: "not-a-date" }),
    ).toEqual({ ok: false, reason: "invalid_deadline" });
  });

  it("検証順: タイトル必須は deadline 検証より優先される", () => {
    // タイトルが空なら deadline が不正でも title_required を返す。
    expect(
      validateTopicInput({ title: "", deadline: "not-a-date" }),
    ).toEqual({ ok: false, reason: "title_required" });
  });
});

describe("evaluateTopicDeletion（削除可否判定）", () => {
  it("running ランがあれば running（最優先・記録があっても）", () => {
    expect(
      evaluateTopicDeletion({
        runningSessionCount: 1,
        studyRecordCount: 5,
        studySessionCount: 3,
      }),
    ).toEqual({ ok: false, reason: "running" });
  });

  it("running なし・StudyRecord ありなら has_records", () => {
    expect(
      evaluateTopicDeletion({
        runningSessionCount: 0,
        studyRecordCount: 2,
        studySessionCount: 0,
      }),
    ).toEqual({ ok: false, reason: "has_records" });
  });

  it("running なし・StudySession ありなら has_records（record 0 でも session で拒否）", () => {
    expect(
      evaluateTopicDeletion({
        runningSessionCount: 0,
        studyRecordCount: 0,
        studySessionCount: 1,
      }),
    ).toEqual({ ok: false, reason: "has_records" });
  });

  it("running・record・session すべて 0 なら ok（記録なしのみ物理削除可）", () => {
    expect(
      evaluateTopicDeletion({
        runningSessionCount: 0,
        studyRecordCount: 0,
        studySessionCount: 0,
      }),
    ).toEqual({ ok: true });
  });

  it("判定の優先順位: running は記録ありより優先される", () => {
    // running>0 のときは studyRecord/studySession の値に関わらず running を返す。
    const verdict = evaluateTopicDeletion({
      runningSessionCount: 2,
      studyRecordCount: 0,
      studySessionCount: 2,
    });
    expect(verdict).toEqual({ ok: false, reason: "running" });
  });
});
