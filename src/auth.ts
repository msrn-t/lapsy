import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { isSessionVersionValid } from "@/lib/session-version";

// NextAuth v5 本体（LAP-002 §3 / §4）。
// Credentials + JWT 戦略・Adapter なし。即時無効化は User.sessionVersion を
// JWT へ焼き込み、jwt callback で DB の最新版と照合して代替する。
// この設定は middleware を除くアプリ全体（auth() / signIn / signOut）で使う。
export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      authorize: async (credentials) => {
        const email =
          typeof credentials?.email === "string" ? credentials.email : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        // authorize の戻り値が jwt callback の `user` に渡る。
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      // 初回サインイン（authorize の戻り値あり）: トークンへ焼き込む
      if (user?.id) {
        token.id = user.id;
        token.isAdmin = user.isAdmin;
        token.sessionVersion = user.sessionVersion;
        return token;
      }

      // 既存トークンの再検証: DB の最新 sessionVersion と照合（失効照合）。
      const fresh = await prisma.user.findUnique({
        where: { id: token.id },
        select: { sessionVersion: true, isAdmin: true },
      });

      if (!isSessionVersionValid(token.sessionVersion, fresh?.sessionVersion)) {
        // 不一致または不在 → null を返してトークンを無効化（未認証扱い）
        return null;
      }

      // 最新の管理者フラグを反映
      token.isAdmin = fresh!.isAdmin;
      return token;
    },
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
        session.user.isAdmin = token.isAdmin;
      }
      return session;
    },
  },
});
