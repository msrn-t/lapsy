import { describe, it, expect } from "vitest";
import {
  validatePresetInput,
  parsePresetConfig,
  MAX_PRESET_NAME_LENGTH,
  MAX_LAPS,
  MIN_WORK_SEC,
  MAX_WORK_SEC,
  MAX_BREAK_SEC,
  type PresetInput,
} from "./preset";

// LAP-008 §9 のテスト対象。純関数 validatePresetInput / parsePresetConfig を検証する。
// バリデーションの各分岐（name / config 空・上限 / ラップ走査内 invalid_number→work→break）、
// 境界値（60/0/上限/上限+1）、検証順序、複数ラップ正常、parsePresetConfig の narrowing を網羅する。

// 有効な1ラップ入力を組み立てるヘルパ（個別フィールドだけ上書きしてテストする）。
function input(overrides: Partial<PresetInput> = {}): PresetInput {
  return {
    name: "標準ポモドーロ",
    laps: [{ workSec: 1500, breakSec: 300 }],
    ...overrides,
  };
}

describe("validatePresetInput（プリセット入力検証・正規化）", () => {
  describe("name の検証", () => {
    it("name が空文字なら name_required", () => {
      expect(validatePresetInput(input({ name: "" }))).toEqual({
        ok: false,
        reason: "name_required",
      });
    });

    it("name が空白のみ（trim 後 0 文字）なら name_required", () => {
      expect(validatePresetInput(input({ name: "  \t\n " }))).toEqual({
        ok: false,
        reason: "name_required",
      });
    });

    it("name が上限ちょうどなら ok（境界）", () => {
      const name = "a".repeat(MAX_PRESET_NAME_LENGTH);
      const result = validatePresetInput(input({ name }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe(name);
    });

    it("name が上限+1（パディングなし）なら name_too_long（厳密境界）", () => {
      expect(
        validatePresetInput(
          input({ name: "a".repeat(MAX_PRESET_NAME_LENGTH + 1) }),
        ),
      ).toEqual({ ok: false, reason: "name_too_long" });
    });

    it("name が上限超過でも前後空白は trim 後の本体で判定する", () => {
      const name = `  ${"a".repeat(MAX_PRESET_NAME_LENGTH + 1)}  `;
      expect(validatePresetInput(input({ name }))).toEqual({
        ok: false,
        reason: "name_too_long",
      });
    });

    it("有効入力で name を trim して保持する", () => {
      const result = validatePresetInput(input({ name: "  集中  " }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe("集中");
    });
  });

  describe("config（ラップ配列）の件数検証", () => {
    it("ラップ配列が空なら empty_config", () => {
      expect(validatePresetInput(input({ laps: [] }))).toEqual({
        ok: false,
        reason: "empty_config",
      });
    });

    it("ラップ数が上限ちょうどなら ok（境界）", () => {
      const laps = Array.from({ length: MAX_LAPS }, () => ({
        workSec: 1500,
        breakSec: 300,
      }));
      const result = validatePresetInput(input({ laps }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.config).toHaveLength(MAX_LAPS);
    });

    it("ラップ数が上限+1 なら too_many_laps（境界）", () => {
      const laps = Array.from({ length: MAX_LAPS + 1 }, () => ({
        workSec: 1500,
        breakSec: 300,
      }));
      expect(validatePresetInput(input({ laps }))).toEqual({
        ok: false,
        reason: "too_many_laps",
      });
    });
  });

  describe("workSec の検証（境界 60 / 上限 14400）", () => {
    it("workSec が下限ちょうど（60）なら ok（境界）", () => {
      const result = validatePresetInput(
        input({ laps: [{ workSec: MIN_WORK_SEC, breakSec: 0 }] }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.config[0].workSec).toBe(MIN_WORK_SEC);
    });

    it("workSec が下限-1（59）なら lap_work_too_short", () => {
      expect(
        validatePresetInput(
          input({ laps: [{ workSec: MIN_WORK_SEC - 1, breakSec: 0 }] }),
        ),
      ).toEqual({ ok: false, reason: "lap_work_too_short" });
    });

    it("workSec が上限ちょうど（14400）なら ok（境界）", () => {
      const result = validatePresetInput(
        input({ laps: [{ workSec: MAX_WORK_SEC, breakSec: 0 }] }),
      );
      expect(result.ok).toBe(true);
    });

    it("workSec が上限+1 なら lap_work_too_long（境界）", () => {
      expect(
        validatePresetInput(
          input({ laps: [{ workSec: MAX_WORK_SEC + 1, breakSec: 0 }] }),
        ),
      ).toEqual({ ok: false, reason: "lap_work_too_long" });
    });
  });

  describe("breakSec の検証（0 許容 / 上限 14400 / 負値拒否）", () => {
    it("breakSec が 0 なら ok（休憩なし許容・境界）", () => {
      const result = validatePresetInput(
        input({ laps: [{ workSec: 1500, breakSec: 0 }] }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.config[0].breakSec).toBe(0);
    });

    it("breakSec が -1 なら break_negative", () => {
      expect(
        validatePresetInput(input({ laps: [{ workSec: 1500, breakSec: -1 }] })),
      ).toEqual({ ok: false, reason: "break_negative" });
    });

    it("breakSec が上限ちょうど（14400）なら ok（境界）", () => {
      const result = validatePresetInput(
        input({ laps: [{ workSec: 1500, breakSec: MAX_BREAK_SEC }] }),
      );
      expect(result.ok).toBe(true);
    });

    it("breakSec が上限+1 なら break_too_long（境界）", () => {
      expect(
        validatePresetInput(
          input({ laps: [{ workSec: 1500, breakSec: MAX_BREAK_SEC + 1 }] }),
        ),
      ).toEqual({ ok: false, reason: "break_too_long" });
    });
  });

  describe("整数パース（フォーム由来文字列・invalid_number）", () => {
    it("文字列の数値を整数秒へパースする", () => {
      const result = validatePresetInput(
        input({ laps: [{ workSec: "1500", breakSec: "300" }] }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.config[0]).toEqual({ workSec: 1500, breakSec: 300 });
      }
    });

    it("文字列は前後空白を trim してからパースする", () => {
      const result = validatePresetInput(
        input({ laps: [{ workSec: "  1500  ", breakSec: "  300 " }] }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.config[0]).toEqual({ workSec: 1500, breakSec: 300 });
      }
    });

    it("workSec が空文字なら invalid_number", () => {
      expect(
        validatePresetInput(input({ laps: [{ workSec: "", breakSec: "300" }] })),
      ).toEqual({ ok: false, reason: "invalid_number" });
    });

    it("workSec が非数値文字列なら invalid_number", () => {
      expect(
        validatePresetInput(
          input({ laps: [{ workSec: "abc", breakSec: "300" }] }),
        ),
      ).toEqual({ ok: false, reason: "invalid_number" });
    });

    it("workSec が小数なら invalid_number（数値型）", () => {
      expect(
        validatePresetInput(
          input({ laps: [{ workSec: 1500.5, breakSec: 300 }] }),
        ),
      ).toEqual({ ok: false, reason: "invalid_number" });
    });

    it("workSec が小数文字列なら invalid_number", () => {
      expect(
        validatePresetInput(
          input({ laps: [{ workSec: "60.5", breakSec: "0" }] }),
        ),
      ).toEqual({ ok: false, reason: "invalid_number" });
    });

    it("breakSec が NaN（数値型）なら invalid_number", () => {
      expect(
        validatePresetInput(input({ laps: [{ workSec: 1500, breakSec: NaN }] })),
      ).toEqual({ ok: false, reason: "invalid_number" });
    });

    it("breakSec が非数値文字列なら invalid_number", () => {
      expect(
        validatePresetInput(
          input({ laps: [{ workSec: "1500", breakSec: "x" }] }),
        ),
      ).toEqual({ ok: false, reason: "invalid_number" });
    });
  });

  describe("検証順序（テストで固定）", () => {
    it("name 必須は config 空より優先される", () => {
      expect(validatePresetInput({ name: "", laps: [] })).toEqual({
        ok: false,
        reason: "name_required",
      });
    });

    it("name 上限超過は config 不正より優先される", () => {
      expect(
        validatePresetInput({
          name: "a".repeat(MAX_PRESET_NAME_LENGTH + 1),
          laps: [{ workSec: "abc", breakSec: "x" }],
        }),
      ).toEqual({ ok: false, reason: "name_too_long" });
    });

    it("config 空は ラップ内容の検証より優先される", () => {
      // 空配列なら走査自体が無いため empty_config を返す。
      expect(validatePresetInput({ name: "有効", laps: [] })).toEqual({
        ok: false,
        reason: "empty_config",
      });
    });

    it("too_many_laps はラップ内容の検証より優先される", () => {
      // 各ラップが不正でも、まず件数上限で弾く。
      const laps = Array.from({ length: MAX_LAPS + 1 }, () => ({
        workSec: "abc",
        breakSec: "x",
      }));
      expect(validatePresetInput({ name: "有効", laps })).toEqual({
        ok: false,
        reason: "too_many_laps",
      });
    });

    it("ラップ走査内では invalid_number が work 範囲より優先される", () => {
      // work が範囲外かつパース不能の場合、invalid_number を先に返す。
      expect(
        validatePresetInput(input({ laps: [{ workSec: "abc", breakSec: 0 }] })),
      ).toEqual({ ok: false, reason: "invalid_number" });
    });

    it("ラップ走査内では work_too_short が break_negative より優先される", () => {
      // 同一ラップで work 短すぎ + break 負の場合、work を先に返す。
      expect(
        validatePresetInput(input({ laps: [{ workSec: 30, breakSec: -10 }] })),
      ).toEqual({ ok: false, reason: "lap_work_too_short" });
    });

    it("複数ラップで最初に違反したラップのコードを返す", () => {
      // 1ラップ目は正常、2ラップ目が不正 → 2ラップ目のコードを返す。
      expect(
        validatePresetInput(
          input({
            laps: [
              { workSec: 1500, breakSec: 300 },
              { workSec: 30, breakSec: 0 },
            ],
          }),
        ),
      ).toEqual({ ok: false, reason: "lap_work_too_short" });
    });
  });

  describe("複数ラップ正常系（個別 work/break）", () => {
    it("ラップごとに個別の work/break を保持し順序を維持する", () => {
      // 例: 1ラップ目 work25分/break5分、2ラップ目 work50分/break10分。
      const result = validatePresetInput({
        name: "段階集中",
        laps: [
          { workSec: 1500, breakSec: 300 },
          { workSec: 3000, breakSec: 600 },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.config).toEqual([
          { workSec: 1500, breakSec: 300 },
          { workSec: 3000, breakSec: 600 },
        ]);
      }
    });

    it("休憩なし（break 0）のラップを含む構成を保存できる", () => {
      const result = validatePresetInput({
        name: "ノンストップ",
        laps: [
          { workSec: 1500, breakSec: 0 },
          { workSec: 1500, breakSec: 0 },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.config.every((c) => c.breakSec === 0)).toBe(true);
      }
    });
  });
});

describe("parsePresetConfig（読込後の防御的 narrowing）", () => {
  it("正しい LapConfig 配列はそのまま narrowing する", () => {
    const raw = [
      { workSec: 1500, breakSec: 300 },
      { workSec: 3000, breakSec: 0 },
    ];
    expect(parsePresetConfig(raw)).toEqual([
      { workSec: 1500, breakSec: 300 },
      { workSec: 3000, breakSec: 0 },
    ]);
  });

  it("配列でない入力は空配列を返す（null）", () => {
    expect(parsePresetConfig(null)).toEqual([]);
  });

  it("配列でない入力は空配列を返す（オブジェクト）", () => {
    expect(parsePresetConfig({ workSec: 1500, breakSec: 300 })).toEqual([]);
  });

  it("配列でない入力は空配列を返す（文字列）", () => {
    expect(parsePresetConfig("not-an-array")).toEqual([]);
  });

  it("undefined は空配列を返す", () => {
    expect(parsePresetConfig(undefined)).toEqual([]);
  });

  it("不正な要素は除外し、正しい要素のみ残す", () => {
    const raw = [
      { workSec: 1500, breakSec: 300 }, // 正常
      { workSec: "1500", breakSec: 300 }, // workSec 文字列 → 除外
      { workSec: 1500 }, // breakSec 欠落 → 除外
      null, // null → 除外
      { workSec: 1500.5, breakSec: 0 }, // 小数 → 除外
      { workSec: 600, breakSec: 60 }, // 正常
    ];
    expect(parsePresetConfig(raw)).toEqual([
      { workSec: 1500, breakSec: 300 },
      { workSec: 600, breakSec: 60 },
    ]);
  });

  it("全要素が不正なら空配列を返す", () => {
    expect(
      parsePresetConfig([{ foo: "bar" }, 42, "x", null]),
    ).toEqual([]);
  });

  it("範囲外でも整数なら narrowing は通す（範囲は強制しない＝表示用途）", () => {
    // 過去データ・手動変更で範囲外でも、表示を壊さないため整数なら採用する。
    const raw = [{ workSec: 30, breakSec: -5 }];
    expect(parsePresetConfig(raw)).toEqual([{ workSec: 30, breakSec: -5 }]);
  });
});
