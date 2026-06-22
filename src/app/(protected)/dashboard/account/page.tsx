import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { signOut } from "@/auth";
import { verifyPassword, hashPassword } from "@/lib/password";
import { validateNewPassword } from "@/lib/password-reset";
import { validateDisplayName, MAX_DISPLAY_NAME_LENGTH } from "@/lib/account";
import { bumpSessionVersion } from "@/lib/auth-revocation";
import { PasswordChangeForm } from "./_password-form";

// アカウント設定ページ（LAP-017 §4-3 / WF 11-settings）。
// 認証・データ分離は二層: (1) auth.config の authorized で /dashboard 配下を保護、
// (2) ページ・各 server action 冒頭で requireUserId()（未認証は /login へ）。
// 3 カード: ① 表示名 ② パスワード変更 ③ 全端末からログアウト。
// 表示名はセッション非伝播のまま Prisma 直読 / revalidatePath で完結する（JWT へ載せない・§3.0-3）。
// 結果通知は presets と統一して ?result=KIND + ResultBanner で行う（§3.0-2）。

const RESULT_PATH = "/dashboard/account";

type ResultKind =
  | "name_updated"
  | "password_changed"
  | "name_too_long"
  | "current_password_wrong"
  | "weak_password";

const SUCCESS_KINDS: ReadonlySet<ResultKind> = new Set<ResultKind>([
  "name_updated",
  "password_changed",
]);

const ERROR_KINDS: ReadonlyArray<ResultKind> = [
  "name_too_long",
  "current_password_wrong",
  "weak_password",
];

// パスワードカードへ渡す（フォーム内エラー枠を出す）result の種別。
const PASSWORD_ERROR_KINDS: ReadonlySet<ResultKind> = new Set<ResultKind>([
  "current_password_wrong",
  "weak_password",
]);

function isResultKind(value: string): value is ResultKind {
  return (
    SUCCESS_KINDS.has(value as ResultKind) ||
    ERROR_KINDS.includes(value as ResultKind)
  );
}

const cardClass =
  "w-full max-w-[480px] rounded-card border border-line bg-card p-6";

const sectionLabelClass =
  "mb-3 font-[family-name:var(--font-fredoka)] text-xs uppercase tracking-wide text-ink-dim";

const inputBase =
  "min-h-[44px] w-full rounded-ctl border border-line-2 bg-fill px-3 text-sm text-ink placeholder:text-placeholder focus:border-line-strong focus:outline-none";

const ghostBtn =
  "inline-flex min-h-[34px] items-center justify-center rounded-ctl border border-line-2 bg-transparent px-4 text-xs text-ink transition hover:bg-nav-active";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  // ページ表示も認証必須（未認証は /login へ）。
  const userId = await requireUserId();
  const { result } = await searchParams;

  const user = await prisma.user.findUnique({
    where: { id: userId }, // ← データ分離・Prisma 直読（name は JWT 非伝播）
    select: { name: true },
  });

  const kind = result && isResultKind(result) ? result : null;
  // パスワードフォームには PW 系 result のみを渡す（表示名系はページ上部バナーで扱う）。
  const passwordInitialError =
    kind && PASSWORD_ERROR_KINDS.has(kind) ? kind : undefined;

  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold text-ink">
          アカウント設定
        </h1>
      </div>

      {kind ? <ResultBanner kind={kind} /> : null}

      {/* ① 表示名 */}
      <section className={cardClass}>
        <p className={sectionLabelClass}>表示名</p>
        <form
          action={updateDisplayName}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label
              htmlFor="name"
              className="mb-2 block text-xs font-medium text-ink"
            >
              表示名（任意）
            </label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={user?.name ?? ""}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              placeholder="例: 山田 太郎"
              className={inputBase}
            />
          </div>
          <button type="submit" className={`${ghostBtn} w-full sm:w-auto`}>
            保存
          </button>
        </form>
      </section>

      {/* ② パスワード変更 */}
      <section className={cardClass}>
        <p className={sectionLabelClass}>パスワード変更</p>
        <PasswordChangeForm
          action={changePassword}
          initialError={passwordInitialError}
        />
      </section>

      {/* ③ セッション（全端末からログアウト） */}
      <section className={cardClass}>
        <p className={sectionLabelClass}>セッション</p>
        <form
          action={logoutAllDevices}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-xs leading-relaxed text-ink-dim">
            すべての端末からログアウトします。再度ログインが必要になります。
          </p>
          <button type="submit" className={`${ghostBtn} w-full sm:w-auto`}>
            全端末からログアウト
          </button>
        </form>
      </section>
    </main>
  );
}

// ① 表示名更新（server action・§3.2）。Prisma 直読更新 + revalidatePath（JWT へ載せない）。
async function updateDisplayName(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const back = (kind: ResultKind) =>
    redirect(`${RESULT_PATH}?result=${kind}`);

  const r = validateDisplayName(String(formData.get("name") ?? ""));
  if (!r.ok) {
    back(r.error); // name_too_long（DB に触れず結果コードで通知）。
    return;
  }

  await prisma.user.update({
    where: { id: userId }, // ← データ分離（§7.5）
    data: { name: r.value },
  });
  revalidatePath(RESULT_PATH);
  back("name_updated");
}

// ② パスワード変更（server action・§3.2）。
// 現在PW照合 → 8 文字検証 → ハッシュ化 → 更新。passwordConfirm は読まない（確認は表示専用）。
async function changePassword(formData: FormData) {
  "use server";

  const userId = await requireUserId();
  const back = (kind: ResultKind) =>
    redirect(`${RESULT_PATH}?result=${kind}`);

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("password") ?? "");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) {
    // セッションは有効でもユーザーが消えていれば防御的に /login へ。
    redirect("/login");
    return;
  }

  const ok = await verifyPassword(current, user.passwordHash);
  if (!ok) {
    back("current_password_wrong");
    return;
  }

  const v = validateNewPassword(next);
  if (!v.ok) {
    back("weak_password");
    return;
  }

  const passwordHash = await hashPassword(next);
  await prisma.user.update({
    where: { id: userId }, // ← データ分離（§7.5）
    data: { passwordHash },
  });
  revalidatePath(RESULT_PATH);
  back("password_changed");
}

// ③ 全端末からログアウト（server action・U4 / §3.2）。
// bumpSessionVersion → signOut の順を厳守（自己 JWT も失効させ /login へ離脱）。
// signOut は NEXT_REDIRECT を throw するため try/catch で囲わない（redirect を素通し）。
async function logoutAllDevices() {
  "use server";

  const userId = await requireUserId();
  await bumpSessionVersion(userId); // 既存セッションを一括失効（§6）
  await signOut({ redirectTo: "/login" }); // 自己 JWT も失効 → 再ログインへ
}

function ResultBanner({ kind }: { kind: ResultKind }) {
  const ok = SUCCESS_KINDS.has(kind);
  const messages: Record<ResultKind, string> = {
    name_updated: "表示名を更新しました。",
    password_changed: "パスワードを変更しました。",
    name_too_long: "表示名が長すぎます（50文字以内）。",
    current_password_wrong: "現在のパスワードが正しくありません。",
    weak_password: "新しいパスワードは8文字以上で設定してください。",
  };

  return (
    <p
      role="alert"
      className={
        ok
          ? "w-full max-w-[480px] rounded-ctl border border-dashed border-line-2 bg-[#EDEDED] px-3 py-2.5 text-xs leading-relaxed text-ink"
          : "w-full max-w-[480px] flex items-start gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
      }
    >
      {messages[kind]}
    </p>
  );
}
