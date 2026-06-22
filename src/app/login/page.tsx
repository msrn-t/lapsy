import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { BrandIcon } from "@/components/brand-icon";
import { LoginForm } from "./login-form";

// ログインページ（LAP-002 §4-A / ワイヤーフレーム docs/wireframes/13_login.html 反映）。
// センタリングのカード型。メール+パスワードを server action で送信し、
// 認証失敗はフォーム上部にまとめて表示（どちらが誤りかは明示しない＝アカウント存在の推測防止）。
// 招待制のため新規登録導線は設けない。

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; accepted?: string; reset?: string }>;
}) {
  const { error, accepted, reset } = await searchParams;

  async function authenticate(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      await signIn("credentials", {
        email,
        password,
        redirectTo: "/dashboard",
      });
    } catch (err) {
      // signIn は成功時に NEXT_REDIRECT を throw するため、それは再 throw する。
      if (err instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw err;
    }
  }

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-card p-8">
        {/* ブランド */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandIcon />
          <span className="font-[family-name:var(--font-fredoka)] text-[26px] font-semibold leading-none text-ink">
            Lapsy
          </span>
          <span className="text-[11px] text-ink-dim">
            ラップで積み上げる、資格学習タイマー
          </span>
        </div>

        {/* 登録完了メッセージ（招待受諾後） */}
        {accepted ? (
          <p
            role="status"
            className="mb-6 rounded-ctl border border-dashed border-line-2 bg-fill px-3 py-2.5 text-xs leading-relaxed text-ink"
          >
            登録が完了しました。設定したパスワードでログインしてください。
          </p>
        ) : null}

        {/* パスワード再設定完了メッセージ（リセット後） */}
        {reset ? (
          <p
            role="status"
            className="mb-6 rounded-ctl border border-dashed border-line-2 bg-fill px-3 py-2.5 text-xs leading-relaxed text-ink"
          >
            パスワードを再設定しました。新しいパスワードでログインしてください。
          </p>
        ) : null}

        {/* 認証失敗（フォーム上部にまとめて表示） */}
        {error ? (
          <p
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-ctl border border-dashed border-error px-3 py-2.5 text-xs text-error"
          >
            メールアドレスまたはパスワードが正しくありません。
          </p>
        ) : null}

        <LoginForm action={authenticate} />

        {/* 招待制の注記（新規登録導線は置かない） */}
        <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-dim">
          ご利用は招待制です。
          <br />
          アカウントが必要な場合は管理者へご連絡ください。
        </p>
      </div>
    </main>
  );
}
