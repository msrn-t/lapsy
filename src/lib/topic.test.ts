import { describe, it, expect } from "vitest";
import {
  validateTopicInput,
  evaluateTopicDeletion,
  computeArchiveMutation,
  computeRestoreMutation,
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

  it("タイトルが上限+1（パディングなし）なら title_too_long（厳密境界）", () => {
    // trim による影響を排した純粋な境界: 本体ちょうど MAX+1 文字。
    expect(
      validateTopicInput({ title: "a".repeat(MAX_TITLE_LENGTH + 1) }),
    ).toEqual({ ok: false, reason: "title_too_long" });
  });

  it("検証順: タイトル上限超過は deadline 検証より優先される", () => {
    // タイトルが長すぎる場合、deadline が不正でも title_too_long を返す。
    expect(
      validateTopicInput({
        title: "a".repeat(MAX_TITLE_LENGTH + 1),
        deadline: "not-a-date",
      }),
    ).toEqual({ ok: false, reason: "title_too_long" });
  });

  it("deadline が空白のみなら null へ正規化（trim 後 0 文字）", () => {
    const result = validateTopicInput({ title: "化学", deadline: "   \t " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.deadline).toBeNull();
  });

  it("deadline は前後空白を trim してからパースする", () => {
    const result = validateTopicInput({
      title: "化学",
      deadline: "  2026-12-31  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deadline?.getTime()).toBe(
        new Date("2026-12-31").getTime(),
      );
    }
  });

  it("deadline が null（明示）でも ok（null → null）", () => {
    const result = validateTopicInput({ title: "化学", deadline: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.deadline).toBeNull();
  });

  it("有効入力で全フィールド（title trim / description trim / deadline Date）を正規化", () => {
    const result = validateTopicInput({
      title: "  物理  ",
      description: "  力学の復習  ",
      deadline: "2027-01-15",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("物理");
      expect(result.value.description).toBe("力学の復習");
      expect(result.value.deadline?.getTime()).toBe(
        new Date("2027-01-15").getTime(),
      );
    }
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

  it("running なし・StudyRecord と StudySession の両方ありなら has_records", () => {
    expect(
      evaluateTopicDeletion({
        runningSessionCount: 0,
        studyRecordCount: 3,
        studySessionCount: 2,
      }),
    ).toEqual({ ok: false, reason: "has_records" });
  });

  it("running=0 だが studySessionCount>0（完了済みラン残存）なら has_records（§3-5）", () => {
    // running は終了済みでもセッション行が残っていれば物理削除させない。
    // §7.4 の過去履歴（StudyRecord）欠落防止の前提を担保する。
    expect(
      evaluateTopicDeletion({
        runningSessionCount: 0,
        studyRecordCount: 0,
        studySessionCount: 5,
      }),
    ).toEqual({ ok: false, reason: "has_records" });
  });
});

// LAP-007 §9 のテスト対象。アーカイブ／復元の mutation 生成（UPDATE 用 data）を
// 固定値で検証する。DB に触れない純関数なので、フラグと archivedAt の設定／クリアを固定する。
describe("computeArchiveMutation（アーカイブ時の更新 data）", () => {
  it("固定 now を渡すと { isArchived:true, archivedAt:<その now> } を返す", () => {
    const now = new Date("2026-06-22T09:30:00.000Z");
    expect(computeArchiveMutation(now)).toEqual({
      isArchived: true,
      archivedAt: now,
    });
  });

  it("archivedAt は渡した now と同一の時刻インスタンスを保持する（変換しない）", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const mutation = computeArchiveMutation(now);
    expect(mutation.isArchived).toBe(true);
    expect(mutation.archivedAt).toBe(now);
  });
});

describe("computeRestoreMutation（復元時の更新 data）", () => {
  it("{ isArchived:false, archivedAt:null } を返す（archivedAt を null クリア）", () => {
    expect(computeRestoreMutation()).toEqual({
      isArchived: false,
      archivedAt: null,
    });
  });

  it("不変条件: 復元では isArchived===false ⟺ archivedAt===null", () => {
    const mutation = computeRestoreMutation();
    expect(mutation.isArchived).toBe(false);
    expect(mutation.archivedAt).toBeNull();
  });
});

// アーカイブ／復元 mutation を横断した不変条件の固定（LAP-007 §3-5 / 設計書 §9）。
// isArchived===true ⟺ archivedAt!=null を、両 mutation の関係として一点に集約して担保する。
// アーカイブ＝archivedAt 設定（非 null）、復元＝archivedAt クリア（null）が常に対になる。
describe("不変条件 isArchived===true ⟺ archivedAt!=null（archive/restore 横断）", () => {
  it("アーカイブは isArchived:true かつ archivedAt が非 null（now がいつでも）", () => {
    // 異なる now を複数渡しても、archivedAt は常に非 null・isArchived は true。
    for (const iso of [
      "1970-01-01T00:00:00.000Z",
      "2026-06-22T09:30:00.000Z",
      "2999-12-31T23:59:59.999Z",
    ]) {
      const now = new Date(iso);
      const m = computeArchiveMutation(now);
      expect(m.isArchived).toBe(true);
      expect(m.archivedAt).not.toBeNull();
      expect(m.archivedAt).toBeInstanceOf(Date);
    }
  });

  it("復元はアーカイブの状態を正確に打ち消す（true/非null → false/null）", () => {
    const archived = computeArchiveMutation(new Date("2026-06-22T09:30:00.000Z"));
    const restored = computeRestoreMutation();
    // 反転していること（フラグが逆・archivedAt の有無が逆）を固定。
    expect(archived.isArchived).toBe(true);
    expect(restored.isArchived).toBe(false);
    expect(archived.archivedAt).not.toBeNull();
    expect(restored.archivedAt).toBeNull();
  });

  it("不変条件: いずれの mutation も isArchived===true のときのみ archivedAt!=null", () => {
    // 両 mutation を集合として検査し、(isArchived===true) === (archivedAt!=null) を保証。
    const mutations = [
      computeArchiveMutation(new Date("2026-06-22T00:00:00.000Z")),
      computeRestoreMutation(),
    ];
    for (const m of mutations) {
      expect(m.isArchived === true).toBe(m.archivedAt != null);
    }
  });
});
