import { BrandIcon } from "@/components/brand-icon";

// ランディング（公開・LAP-016 §4-1 / U2）。
// 専用 WF は無いため、認証ページ共通のセンタリングカード規約（.auth-card・グレースケールトークン）に
// 整合させ、サービス説明 + ログイン誘導 + 招待制注記を構成する。静的（server action なし）。

export default function Home() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center">
      <div className="w-full max-w-[380px] rounded-card border border-line bg-card px-6 py-8">
        {/* ブランド */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandIcon size={56} />
          <span className="font-[family-name:var(--font-fredoka)] text-[24px] font-semibold leading-none text-ink">
            Lapsy
          </span>
          <span className="text-[11px] text-ink-dim">
            ラップで積み上げる、資格学習タイマー
          </span>
        </div>

        {/* サービス説明 */}
        <p className="mb-6 text-center text-sm leading-relaxed text-ink-dim">
          IT資格学習支援アプリ。ポモドーロタイマーのラップ単位で学習を区切り、積み重ねていきます。
        </p>

        {/* ログイン誘導 */}
        <a
          href="/login"
          className="flex min-h-[46px] w-full items-center justify-center rounded-ctl bg-btn font-[family-name:var(--font-fredoka)] text-sm font-medium text-btn-ink transition hover:opacity-90"
        >
          ログイン
        </a>

        {/* 招待制の注記 */}
        <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-dim">
          ご利用は招待制です。
          <br />
          アカウントが必要な場合は管理者へご連絡ください。
        </p>
      </div>
    </main>
  );
}
