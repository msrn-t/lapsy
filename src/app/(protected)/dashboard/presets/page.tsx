import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  validatePresetInput,
  parsePresetConfig,
  MAX_LAPS,
  type LapConfig,
} from "@/lib/preset";
import { LapRows, collectLaps } from "./_form";

// ポモドーロのプリセット一覧 + 作成 + 削除（LAP-008 §3 / §4）。
// 認証・データ分離は二層: (1) auth.config の authorized で /dashboard 配下をログイン必須に保護、
// (2) ページ・各 server action 冒頭で requireUserId()（未認証は /login へ）。
// 全クエリは requireUserId() 由来 userId でフィルタし、更新/削除は where:{id,userId} を併用する（§7.5）。
// JSONB config は読込後 parsePresetConfig で narrowing し信頼しない（§3-3）。
// Preset は FK 子を持たないため P2003/TOCTOU フォールバックは不要（§3-5）。

type ResultKind =
  | "created"
  | "updated"
  | "deleted"
  | "name_required"
  | "name_too_long"
  | "empty_config"
  | "too_many_laps"
  | "lap_work_too_short"
  | "lap_work_too_long"
  | "break_negative"
  | "break_too_long"
  | "invalid_number"
  | "not_found";

const SUCCESS_KINDS: ReadonlySet<ResultKind> = new Set<ResultKind>([
  "created",
  "updated",
  "deleted",
]);

const ERROR_KINDS: ReadonlyArray<ResultKind> = [
  "name_required",
  "name_too_long",
  "empty_config",
  "too_many_laps",
  "lap_work_too_short",
  "lap_work_too_long",
  "break_negative",
  "break_too_long",
  "invalid_number",
  "not_found",
];

function isResultKind(value: string): value is ResultKind {
  return (
    SUCCESS_KINDS.has(value as ResultKind) ||
    ERROR_KINDS.includes(value as ResultKind)
  );
}

// config を「全ラップの合計作業/休憩」の要約文字列にする（一覧表示用）。
function summarizeConfig(config: LapConfig[]): string {
  if (config.length === 0) return "（設定なし）";
  return config
    .map(
      (c, i) =>
        `${i + 1}: 作業${c.workSec}秒 / 休憩${c.breakSec}秒`,
    )
    .join("、");
}

// 合計作業時間（分）を「約N分」表記にする（WF カードの合計時間注記・表示のみ）。
function totalWorkLabel(config: LapConfig[]): string {
  const totalSec = config.reduce((acc, c) => acc + c.workSec, 0);
  const min = Math.round(totalSec / 60);
  return `合計 約${min}分（作業のみ）`;
}

export default async function PresetsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  // ページ表示も認証必須（未認証は /login へ）。
  const userId = await requireUserId();
  const { result } = await searchParams;

  const presets = await prisma.preset.findMany({
    where: { userId }, // ← データ分離（§7.5）
    select: { id: true, name: true, config: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      {/* WF .page-h（見出し + 新規ボタン）。タイトルは shell トップバーが描画。 */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold">
          プリセット
        </h3>
        <span className="flex-1" />
        <a
          href="#new-preset"
          className="inline-flex min-h-[34px] items-center justify-center rounded-ctl bg-btn px-4 text-xs text-btn-ink"
        >
          ＋ 新規プリセット
        </a>
      </div>

      {result && isResultKind(result) ? <ResultBanner kind={result} /> : null}

      <form
        id="new-preset"
        action={createPreset}
        className="flex flex-col gap-3 rounded-card border border-line bg-card p-6"
      >
        <p className="font-[family-name:var(--font-fredoka)] text-xs font-medium uppercase tracking-wide text-ink-dim">
          新しいプリセットを作成
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            プリセット名<span className="text-ink-dim">*</span>
          </span>
          <input
            type="text"
            name="name"
            required
            maxLength={200}
            placeholder="例: 標準ポモドーロ"
            className="min-h-[44px] rounded-ctl border border-line-2 bg-fill px-3 text-sm placeholder:text-placeholder"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            ラップ（作業/休憩を秒で入力・空欄の行は無視されます）
          </legend>
          <p className="text-xs text-ink-dim">
            作業時間は60秒以上、休憩時間は0秒以上。最低1ラップ・最大{MAX_LAPS}
            ラップ。
          </p>
          <LapRows />
        </fieldset>

        <button
          type="submit"
          className="inline-flex min-h-[34px] items-center justify-center self-start rounded-ctl bg-btn px-4 text-xs text-btn-ink"
        >
          作成
        </button>
      </form>

      {presets.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-2 px-6 py-8 text-center text-xs leading-7 text-ink-dim">
          まだプリセットがありません。上のフォームから作成してください。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((p) => {
            const config = parsePresetConfig(p.config);
            return (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded-card border border-line bg-card p-6"
              >
                <span className="font-[family-name:var(--font-fredoka)] font-semibold">
                  {p.name}
                </span>
                <span className="text-[11px] text-ink-dim">
                  {config.length}ラップ ・ {totalWorkLabel(config)}
                </span>
                <span className="text-[11px] text-ink-dim">
                  {summarizeConfig(config)}
                </span>

                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/presets/${p.id}/edit`}
                    className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-line-2 px-4 text-xs text-ink"
                  >
                    編集
                  </Link>
                  <form action={deletePreset}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-dashed border-error px-4 text-xs text-error"
                    >
                      削除
                    </button>
                  </form>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// 作成（server action・§4-A）。認証はセッション由来 userId で行い、クライアント入力を信頼しない。
async function createPreset(formData: FormData) {
  "use server";

  const userId = await requireUserId();

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/presets?result=${kind}`);

  const validation = validatePresetInput({
    name: String(formData.get("name") ?? ""),
    laps: collectLaps(formData),
  });

  if (!validation.ok) {
    back(validation.reason); // DB に触れず結果コードで通知。
    return;
  }

  await prisma.preset.create({
    data: {
      userId,
      name: validation.value.name,
      config: validation.value.config, // 正規化済み LapConfig[] のみを書く（§3-3）。
    },
  });
  revalidatePath("/dashboard/presets");
  back("created");
}

// 削除（server action・§4-C）。where:{id,userId} でデータ分離。
// Preset は FK 子を持たないため物理削除は常に成功する（P2003 フォールバック不要・§3-5）。
async function deletePreset(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");

  const back = (kind: ResultKind) =>
    redirect(`/dashboard/presets?result=${kind}`);

  const { count } = await prisma.preset.deleteMany({ where: { id, userId } });
  if (count === 0) {
    back("not_found"); // 対象なし or 他人の行を一様に扱う。
    return;
  }

  revalidatePath("/dashboard/presets");
  back("deleted");
}

function ResultBanner({ kind }: { kind: ResultKind }) {
  const ok = SUCCESS_KINDS.has(kind);
  const messages: Record<ResultKind, string> = {
    created: "プリセットを作成しました。",
    updated: "プリセットを更新しました。",
    deleted: "プリセットを削除しました。",
    name_required: "プリセット名は必須です。",
    name_too_long: "プリセット名が長すぎます。",
    empty_config: "ラップを最低1つ設定してください。",
    too_many_laps: "ラップ数が多すぎます（上限 20）。",
    lap_work_too_short: "ラップの作業時間は60秒以上に設定してください。",
    lap_work_too_long: "設定時間が長すぎます。",
    break_negative: "休憩時間に負の値は設定できません。",
    break_too_long: "設定時間が長すぎます。",
    invalid_number: "作業時間・休憩時間は整数（秒）で入力してください。",
    not_found: "対象のプリセットが見つかりませんでした。",
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
