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
    <main className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">ポモドーロ プリセット</h1>

      {result && isResultKind(result) ? <ResultBanner kind={result} /> : null}

      <form
        action={createPreset}
        className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-800"
      >
        <h2 className="text-sm font-semibold">新しいプリセットを作成</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            プリセット名<span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            name="name"
            required
            maxLength={200}
            placeholder="例: 標準ポモドーロ"
            className="rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            ラップ（作業/休憩を秒で入力・空欄の行は無視されます）
          </legend>
          <p className="text-xs text-gray-500">
            作業時間は60秒以上、休憩時間は0秒以上。最低1ラップ・最大{MAX_LAPS}
            ラップ。
          </p>
          <LapRows />
        </fieldset>

        <button
          type="submit"
          className="self-start rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          作成
        </button>
      </form>

      {presets.length === 0 ? (
        <p className="text-sm text-gray-500">
          まだプリセットがありません。上のフォームから作成してください。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-200 rounded border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {presets.map((p) => {
            const config = parsePresetConfig(p.config);
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <span className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-gray-500">
                    {config.length}ラップ
                  </span>
                  <span className="text-xs text-gray-400">
                    {summarizeConfig(config)}
                  </span>
                </span>

                <span className="flex items-center gap-2">
                  <Link
                    href={`/dashboard/presets/${p.id}/edit`}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                  >
                    編集
                  </Link>
                  <form action={deletePreset}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
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
    </main>
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
          ? "rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
          : "rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
      }
    >
      {messages[kind]}
    </p>
  );
}
