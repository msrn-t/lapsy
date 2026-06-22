"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { scorePasswordStrength, passwordsMatch } from "@/lib/password";

// パスワード変更フォーム（クライアント・LAP-017 §4-4）。invite/[token]/_form.tsx と同型。
// 差分: 先頭に「現在のパスワード」フィールドが増える / initialError は PW 変更系
// （current_password_wrong / weak_password）。
// 強度メーター・確認一致は表示専用の UX 補助であり、サーバーは currentPassword + password の
// 2 値のみを読む。name="passwordConfirm" はサーバー action で読み取らない
// （現在PW照合 + 8 文字検証が最終防壁・§3.2）。

type PasswordError = "current_password_wrong" | "weak_password";

const ERROR_MESSAGES: Record<PasswordError, string> = {
  current_password_wrong: "現在のパスワードが正しくありません。",
  weak_password: "新しいパスワードは8文字以上で設定してください。",
};

const inputBase =
  "min-h-[44px] w-full rounded-ctl border border-line-2 bg-fill px-3 text-sm text-ink placeholder:text-placeholder focus:border-line-strong focus:outline-none";

const eyeBtn =
  "absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-line bg-fill px-2 py-1 text-[11px] text-ink-dim transition hover:opacity-90";

// 強度 → 塗り幅クラス（WF .meter i・§3.3）。
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
      {pending ? "更新中…" : "パスワードを更新"}
    </button>
  );
}

function Fields({ initialError }: { initialError?: string }) {
  const { pending } = useFormStatus();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = scorePasswordStrength(pw);
  // 確認が非空のときだけ不一致エラーを出す（入力途中の早出しを防ぐ）。
  const mismatch = confirm.length > 0 && !passwordsMatch(pw, confirm);
  // 現在PW誤りは初回描画時のみ表示（サーバーからの ?result 由来）。
  const currentWrong = initialError === "current_password_wrong";

  return (
    <fieldset disabled={pending} className="contents">
      {/* 現在のパスワード（表示トグル・現在PW誤りエラー） */}
      <div className="mb-4">
        <label
          htmlFor="currentPassword"
          className="mb-2 block text-xs font-medium text-ink"
        >
          現在のパスワード
        </label>
        <div className="relative">
          <input
            id="currentPassword"
            name="currentPassword"
            type={showCurrent ? "text" : "password"}
            required
            autoComplete="current-password"
            aria-invalid={currentWrong}
            className={`${inputBase} pr-16 ${currentWrong ? "border-dashed border-error" : ""}`}
          />
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            aria-pressed={showCurrent}
            aria-label={showCurrent ? "パスワードを隠す" : "パスワードを表示"}
            className={eyeBtn}
          >
            {showCurrent ? "隠す" : "表示"}
          </button>
        </div>
        {currentWrong ? (
          <p role="alert" className="mt-1.5 text-[11px] text-error">
            現在のパスワードが正しくありません
          </p>
        ) : null}
      </div>

      {/* 新しいパスワード（表示トグル + 強度メーター） */}
      <div className="mb-4">
        <label
          htmlFor="password"
          className="mb-2 block text-xs font-medium text-ink"
        >
          新しいパスワード
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
        {/* 強度メーター（表示専用・塗り幅は §3.3） */}
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

      {/* 新しいパスワード（確認）（表示トグル + 不一致エラー・サーバー無視） */}
      <div className="mb-4">
        <label
          htmlFor="passwordConfirm"
          className="mb-2 block text-xs font-medium text-ink"
        >
          新しいパスワード（確認）
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

export function PasswordChangeForm({
  action,
  initialError,
}: {
  action: (formData: FormData) => Promise<void>;
  initialError?: string;
}) {
  const knownError =
    initialError === "current_password_wrong" ||
    initialError === "weak_password"
      ? (initialError as PasswordError)
      : null;

  return (
    <div>
      {knownError ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
        >
          {ERROR_MESSAGES[knownError]}
        </p>
      ) : null}
      <form action={action}>
        <Fields initialError={initialError} />
      </form>
    </div>
  );
}
