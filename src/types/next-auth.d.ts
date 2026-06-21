import type { DefaultSession } from "next-auth";

// Session / JWT の型拡張（LAP-002 §4）。
// id / isAdmin / sessionVersion を認証情報に乗せる。

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      isAdmin: boolean;
    } & DefaultSession["user"];
  }

  // authorize の戻り値・jwt callback の user に乗る独自フィールド
  interface User {
    isAdmin: boolean;
    sessionVersion: number;
  }
}

// JWT インターフェースは @auth/core/jwt に定義されており、next-auth/jwt は
// その re-export。型マージは定義元モジュールに対して行う必要がある。
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    isAdmin: boolean;
    sessionVersion: number;
  }
}
