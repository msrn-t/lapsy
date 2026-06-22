import Link from "next/link";
import { BrandIcon } from "@/components/brand-icon";

// 404 ページ（LAP-017 §4-5 / WF 12-errors の 404）。
// Next.js 規約: ルート直下の not-found.tsx は全 unmatched パス（公開/保護問わず）に効く。
// shell 外・中央寄せカードで描画する（(protected)/layout.tsx を通らない）。
// 復帰導線は WF どおり 1 つ（ダッシュボードへ）。GET 遷移なので <Link>。

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page p-6">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-card px-6 py-8 text-center">
        <div className="mb-4 flex justify-center">
          <BrandIcon size={112} />
        </div>
        <p className="font-[family-name:var(--font-fredoka)] text-5xl font-semibold text-ink">
          404
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-fredoka)] text-base font-semibold text-ink">
          ページが見つかりません
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">
          お探しのページは存在しないか、移動した可能性があります。
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex min-h-[34px] items-center justify-center rounded-ctl bg-btn px-4 font-[family-name:var(--font-fredoka)] text-xs font-medium text-btn-ink transition hover:opacity-90"
        >
          ダッシュボードへ
        </Link>
      </div>
    </main>
  );
}
