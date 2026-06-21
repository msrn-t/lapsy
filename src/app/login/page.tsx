import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { LoginForm } from "./login-form";

// ログインページ（LAP-002 §4-A / ワイヤーフレーム docs/wireframes/lapsy-login-wireframe.html 反映）。
// センタリングのカード型。メール+パスワードを server action で送信し、
// 認証失敗はフォーム上部にまとめて表示（どちらが誤りかは明示しない＝アカウント存在の推測防止）。
// 招待制のため新規登録導線は設けない。

function BrandIcon() {
  return (
    <svg
      width="112"
      height="112"
      viewBox="0 0 512 512"
      role="img"
      aria-label="Lapsy"
    >
      <rect width="512" height="512" rx="120" fill="#54C3F1" />
      <circle cx="256" cy="256" r="116" fill="#FFFFFF" />
      <ellipse cx="216.56" cy="297.76" rx="34.8" ry="18.56" fill="#DDEFFB" opacity="0.85" />
      <ellipse cx="295.44" cy="216.56" rx="23.2" ry="15.08" fill="#EAF6FD" />
      <path
        d="M366.2,134.88 L373.48,153.6 L392.2,160.88 L373.48,168.16 L366.2,186.88 L358.92,168.16 L340.2,160.88 L358.92,153.6 Z"
        fill="#FFC93C"
      />
      <circle cx="142.32" cy="207.28" r="6.5" fill="#FFFFFF" opacity="0.9" />
      <circle cx="192.2" cy="135.36" r="4.5" fill="#FFFFFF" opacity="0.75" />
    </svg>
  );
}

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
      <div className="w-full max-w-[420px] rounded-2xl border border-gray-300 bg-white p-8">
        {/* ブランド */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandIcon />
          <span className="font-[family-name:var(--font-fredoka)] text-[26px] font-semibold leading-none text-gray-700">
            Lapsy
          </span>
          <span className="text-[11px] text-gray-500">
            ラップで積み上げる、資格学習タイマー
          </span>
        </div>

        {/* 登録完了メッセージ（招待受諾後） */}
        {accepted ? (
          <p
            role="status"
            className="mb-6 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-xs text-gray-600"
          >
            登録が完了しました。設定したパスワードでログインしてください。
          </p>
        ) : null}

        {/* パスワード再設定完了メッセージ（リセット後） */}
        {reset ? (
          <p
            role="status"
            className="mb-6 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-xs text-gray-600"
          >
            パスワードを再設定しました。新しいパスワードでログインしてください。
          </p>
        ) : null}

        {/* 認証失敗（フォーム上部にまとめて表示） */}
        {error ? (
          <p
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-xl border border-dashed border-gray-500 px-3 py-2.5 text-xs text-gray-600"
          >
            メールアドレスまたはパスワードが正しくありません。
          </p>
        ) : null}

        <LoginForm action={authenticate} />

        {/* 招待制の注記（新規登録導線は置かない） */}
        <p className="mt-6 text-center text-[11px] leading-relaxed text-gray-500">
          ご利用は招待制です。
          <br />
          アカウントが必要な場合は管理者へご連絡ください。
        </p>
      </div>
    </main>
  );
}
