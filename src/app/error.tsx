"use client";

import { useEffect } from "react";
import { BrandIcon } from "@/components/brand-icon";

// 500 / ランタイムエラー境界（LAP-017 §4-6 / WF 12-errors の 500）。
// Next.js 規約: ルート app/error.tsx は "use client" 必須で { error, reset } を受け取る。
// shell 外・中央寄せカード。復帰導線は WF どおり 1 つ（再読み込み = reset()）。
//
// 機密非露出（受け入れ条件・Risk④）: 画面には固定文言のみを出す。
// error.message / stack は描画しない。error.digest（Next が付与する相関ハッシュ・
// 機密でない）のみ任意表示。console.error はサーバー/クライアントログ限定。

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ログにのみ残す（画面には出さない）。
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page p-6">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-card px-6 py-8 text-center">
        <div className="mb-4 flex justify-center">
          <BrandIcon size={112} />
        </div>
        <p className="font-[family-name:var(--font-fredoka)] text-5xl font-semibold text-ink">
          500
        </p>
        <h2 className="mt-2 font-[family-name:var(--font-fredoka)] text-base font-semibold text-ink">
          問題が発生しました
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">
          サーバー側でエラーが発生しました。時間をおいて再度お試しください。
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 inline-flex min-h-[34px] items-center justify-center rounded-ctl bg-btn px-4 font-[family-name:var(--font-fredoka)] text-xs font-medium text-btn-ink transition hover:opacity-90"
        >
          再読み込み
        </button>
        {error.digest ? (
          <p className="mt-3 text-[10px] text-ink-dim">エラーID: {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
