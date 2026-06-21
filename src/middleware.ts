import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// 保護ルートの一元ガード（LAP-002 §3 方針5 / §4-C）。
// middleware は edge 上で動くため、Prisma / bcryptjs を含まない authConfig のみを使う。
// 失効照合（DB アクセス）は node 側の auth() 側で行う（§4-D の分割）。
// authorized callback（auth.config.ts）が保護判定を行い、未認証は /login へ送る。
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // 静的アセット・画像最適化・favicon・認証 API を除外して評価する。
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
