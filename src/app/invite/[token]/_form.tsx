"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { scorePasswordStrength, passwordsMatch } from "@/lib/password";

// 招待受諾フォーム（クライアント・LAP-016 §4-3）。login-form.tsx と同型。
// パスワード + 確認 + 強度メーター + 表示トグルを実装する。
// 強度メーター・確認一致は表示専用の UX 補助であり、サーバーは password 1 値のみを読む。
// name="passwordConfirm" はサーバー action で読み取らない（8 文字検証が最終防壁）。

type AcceptError =
  | "not_found"
  | "already_accepted"
  | "expired"
  | "already_registered"
  | "weak_password";

const ERROR_MESSAGES: Record<AcceptError, string> = {
  not_found: "招待リンクが無効です。リンクが正しいかご確認ください。",
  already_accepted: "この招待は既に使用されています。ログインしてください。",
  expired: "招待リンクの有効期限が切れています。管理者へ再招待を依頼してください。",
  already_registered:
    "このメールアドレスは既に登録済みです。ログインしてください。",
  weak_password: "パスワードは8文字以上で設定してください。",
};

const inputBase =
  "min-h-[44px] w-full rounded-ctl border border-line-2 bg-fill px-3 text-sm text-ink placeholder:text-placeholder focus:border-line-strong focus:outline-none";

const eyeBtn =
  "absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-line bg-fill px-2 py-1 text-[11px] text-ink-dim transition hover:opacity-90";

// 強度 → 塗り幅クラス（WF .meter i・§3.2）。
const METER_WIDTH: Record<ReturnType<typeof scorePasswordStrength>, string> = {
  weak: "w-1/3",
  medium: "w-2/3",
  strong: "w-full",
};

const METER_LABEL: Record<ReturnType<typeof scorePasswordStrength>, string> = {
  weak: "弱",
  medium: "中",
  strong: "強",
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="flex min-h-[46px] w-full items-center justify-center rounded-ctl bg-btn font-[family-name:var(--font-fredoka)] text-sm font-medium text-btn-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "登録中…" : "登録して始める"}
    </button>
  );
}

function Fields({ email }: { email: string }) {
  const { pending } = useFormStatus();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = scorePasswordStrength(pw);
  // 確認が非空のときだけ不一致エラーを出す（入力途中の早出しを防ぐ）。
  const mismatch = confirm.length > 0 && !passwordsMatch(pw, confirm);

  return (
    <fieldset disabled={pending} className="contents">
      {/* メールアドレス（招待先・固定表示） */}
      <div className="mb-6">
        <label htmlFor="email" className="mb-2 block text-xs font-medium text-ink">
          メールアドレス
        </label>
        <input
          id="email"
          type="email"
          value={email}
          readOnly
          className={`${inputBase} bg-fill text-ink-dim`}
        />
      </div>

      {/* パスワード（表示トグル + 強度メーター） */}
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
            type={showPw ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className={`${inputBase} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-pressed={showPw}
            aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
            className={eyeBtn}
          >
            {showPw ? "隠す" : "表示"}
          </button>
        </div>
        {/* 強度メーター（表示専用・塗り幅は §3.2） */}
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill"
          role="presentation"
        >
          <span
            className={`block h-full bg-progress transition-[width] ${pw.length > 0 ? METER_WIDTH[strength] : "w-0"}`}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-ink-dim">
          8文字以上 / 強度は目安です
          {pw.length > 0 ? `（${METER_LABEL[strength]}）` : ""}
        </p>
      </div>

      {/* パスワード確認（表示トグル + 不一致エラー） */}
      <div className="mb-6">
        <label
          htmlFor="passwordConfirm"
          className="mb-2 block text-xs font-medium text-ink"
        >
          パスワード（確認）
        </label>
        <div className="relative">
          <input
            id="passwordConfirm"
            name="passwordConfirm"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            className={`${inputBase} pr-16 ${mismatch ? "border-dashed border-error" : ""}`}
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-pressed={showConfirm}
            aria-label={showConfirm ? "パスワードを隠す" : "パスワードを表示"}
            className={eyeBtn}
          >
            {showConfirm ? "隠す" : "表示"}
          </button>
        </div>
        {mismatch ? (
          <p role="alert" className="mt-1.5 text-[11px] text-error">
            パスワードが一致しません
          </p>
        ) : null}
      </div>

      <SubmitButton disabled={mismatch} />
    </fieldset>
  );
}

export function InviteAcceptForm({
  action,
  email,
  initialError,
}: {
  action: (formData: FormData) => Promise<void>;
  email: string;
  initialError?: string;
}) {
  return (
    <div>
      {initialError ? (
        <p
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
        >
          {ERROR_MESSAGES[initialError as AcceptError] ??
            "エラーが発生しました。"}
        </p>
      ) : null}
      <form action={action}>
        <Fields email={email} />
      </form>
    </div>
  );
}
