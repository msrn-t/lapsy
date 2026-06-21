import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest 設定（LAP-002 §4）。純ロジック中心のため node 環境。
// テストは対象の隣に *.test.ts を置く規約。
export default defineConfig({
  resolve: {
    alias: {
      // tsconfig の paths（@/* → ./src/*）を Vitest にも反映する。
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
