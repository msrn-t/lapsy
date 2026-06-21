import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { validatePresetInput, parsePresetConfig, MAX_LAPS } from "@/lib/preset";
import { LapRows, collectLaps } from "../../_form";

// ポモドーロのプリセット編集（LAP-008 §3 / §4-B）。
// 認証・データ分離は二層: ページ・server action 冒頭で requireUserId() を呼び、
// 取得・更新は where:{id,userId} を併用して他ユーザーの行に触れないようにする（§7.5）。
// 既存 config は parsePresetConfig で narrowing してフォームへプリフィルする（§3-3）。

export default async function EditPresetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;

  // データ分離: where:{id,userId} で取得。他人の行・不在は一様に not_found へ。
  const preset = await prisma.preset.findFirst({
    where: { id, userId },
    select: { id: true, name: true, config: true },
  });

  if (!preset) {
    redirect("/dashboard/presets?result=not_found");
  }

  const config = parsePresetConfig(preset.config);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">プリセットを編集</h1>

      <form
        action={updatePreset}
        className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-800"
      >
        <input type="hidden" name="id" value={preset.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            プリセット名<span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            name="name"
            required
            maxLength={200}
            defaultValue={preset.name}
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
          <LapRows initial={config} />
        </fieldset>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            更新
          </button>
          <Link
            href="/dashboard/presets"
            className="rounded px-3 py-1.5 text-sm font-medium text-gray-500 hover:underline"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </main>
  );
}

// 更新（server action・§4-B）。認証はセッション由来 userId で行い、where:{id,userId} を併用する。
async function updatePreset(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");

  const back = (kind: string) =>
    redirect(`/dashboard/presets?result=${kind}`);

  const validation = validatePresetInput({
    name: String(formData.get("name") ?? ""),
    laps: collectLaps(formData),
  });

  if (!validation.ok) {
    back(validation.reason); // DB に触れず結果コードで通知。
    return;
  }

  // データ分離: updateMany の where:{id,userId} で他人の行を更新できないようにする。
  const { count } = await prisma.preset.updateMany({
    where: { id, userId },
    data: {
      name: validation.value.name,
      config: validation.value.config, // 正規化済み LapConfig[] のみを書く（§3-3）。
    },
  });

  if (count === 0) {
    back("not_found"); // 対象なし or 他人の行を一様に扱う。
    return;
  }

  revalidatePath("/dashboard/presets");
  back("updated");
}
