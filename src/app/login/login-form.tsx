"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

// ログインフォーム（クライアント）。ワイヤーフレーム（docs/wireframes/lapsy-login-wireframe.html）に準拠:
// - パスワードの表示/非表示トグル（既定は非表示）
// - 送信中はボタンをローディング表示＋入力欄を操作不可（多重送信防止）
// server action は親（server component）から prop で受け取る。

const inputBase =
  "h-11 w-full rounded-xl border border-gray-400 bg-gray-50 px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-200";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-[46px] w-full items-center justify-center rounded-xl bg-gray-700 font-[family-name:var(--font-fredoka)] text-[15px] font-medium tracking-wide text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "ログイン中…" : "ログイン"}
    </button>
  );
}

function Fields() {
  const { pending } = useFormStatus();
  const [show, setShow] = useState(false);

  return (
    <fieldset disabled={pending} className="contents">
      {/* メールアドレス */}
      <div className="mb-6">
        <label
          htmlFor="email"
          className="mb-2 block text-xs font-medium text-gray-700"
        >
          メールアドレス
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={inputBase}
        />
      </div>

      {/* パスワード（表示/非表示トグル） */}
      <div className="mb-6">
        <label
          htmlFor="password"
          className="mb-2 block text-xs font-medium text-gray-700"
        >
          パスワード
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            className={`${inputBase} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-pressed={show}
            aria-label={show ? "パスワードを隠す" : "パスワードを表示"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-gray-300 bg-gray-100 px-2 py-1 text-[11px] text-gray-600 transition hover:bg-gray-200"
          >
            {show ? "隠す" : "表示"}
          </button>
        </div>
      </div>

      {/* ログイン状態を保持 + パスワードリセット導線 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            name="remember"
            className="h-4 w-4 rounded border-gray-400 text-gray-700"
          />
          ログイン状態を保持する
        </label>
        <a
          href="/password-reset"
          className="text-xs text-gray-700 underline underline-offset-2 hover:text-gray-900"
        >
          パスワードをお忘れですか？
        </a>
      </div>

      <SubmitButton />
    </fieldset>
  );
}

export function LoginForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <Fields />
    </form>
  );
}
