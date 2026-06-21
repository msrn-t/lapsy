import type { NextAuthConfig } from "next-auth";

// edge 互換の最小設定（LAP-002 §3 方針5 / §4）。
// Prisma / bcryptjs（edge 非互換）は含めない。middleware はこの設定のみを使い、
// DB 照合を伴う重い処理（authorize・失効照合）は auth.ts 側に置く。
//
// providers は空。実プロバイダ（Credentials + authorize）は auth.ts でマージする。
// authorized callback で middleware の保護判定を一元化する。
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    // middleware（src/middleware.ts）から呼ばれる保護判定。
    // 保護対象ルートで未認証なら false → /login へリダイレクトされる。
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnProtected = nextUrl.pathname.startsWith("/dashboard");

      if (isOnProtected) {
        return isLoggedIn; // 未認証なら false → signIn ページへ
      }

      // 認証済みユーザーが /login に来たら /dashboard へ送る
      if (isLoggedIn && nextUrl.pathname === "/login") {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
