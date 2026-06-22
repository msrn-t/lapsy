"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

// ログインフォーム（クライアント）。ワイヤーフレーム（docs/wireframes/lapsy-login-wireframe.html）に準拠:
// - パスワードの表示/非表示トグル（既定は非表示）
// - 送信中はボタンをローディング表示＋入力欄を操作不可（多重送信防止）
// server action は親（server component）から prop で受け取る。

const inputBase =
  "min-h-[44px] w-full rounded-ctl border border-line-2 bg-fill px-3 text-sm text-ink placeholder:text-placeholder focus:border-line-strong focus:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-[46px] w-full items-center justify-center rounded-ctl bg-btn font-[family-name:var(--font-fredoka)] text-[15px] font-medium tracking-wide text-btn-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
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
          className="mb-2 block text-xs font-medium text-ink"
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
          className="mb-2 block text-xs font-medium text-ink"
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
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-line bg-[#EFEFEF] px-2 py-1 text-[11px] text-ink-dim transition hover:opacity-90"
          >
            {show ? "隠す" : "表示"}
          </button>
        </div>
      </div>

      {/* ログイン状態を保持 + パスワードリセット導線（同一行・同じ高さ・リンク右揃え） */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-ink">
          <input
            type="checkbox"
            name="remember"
            className="h-4 w-4 rounded border-line-2 text-ink"
          />
          ログイン状態を保持する
        </label>
        <a
          href="/password-reset"
          className="whitespace-nowrap text-xs text-ink underline underline-offset-2 hover:opacity-80"
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
