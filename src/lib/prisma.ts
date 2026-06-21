import { PrismaClient } from "@prisma/client";

// PrismaClient シングルトン。Next.js の開発時 HMR で複数インスタンスが
// 生成されるのを防ぐため globalThis にキャッシュする（LAP-002 §4）。
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
