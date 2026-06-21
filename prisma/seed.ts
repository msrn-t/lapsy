import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

// 初期管理者 seed（LAP-002 §4-E）。冪等（upsert・update:{}）。
// 認証情報は環境変数からのみ読み、ハードコードしない。未設定はエラー終了。

const prisma = new PrismaClient();

/**
 * env から seed 用の管理者資格情報を読み出す純関数。
 * 未設定（空文字含む）なら例外を投げる（ハードコード防止）。
 */
export function readAdminCredentials(
  env: Record<string, string | undefined>,
): {
  email: string;
  password: string;
} {
  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;

  if (!email) {
    throw new Error(
      "ADMIN_EMAIL が未設定です。.env に設定してから seed を実行してください。",
    );
  }
  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD が未設定です。.env に設定してから seed を実行してください。",
    );
  }
  return { email, password };
}

async function main() {
  const { email, password } = readAdminCredentials(process.env);
  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    // 既存ユーザーは変更しない（再実行で重複作成もパスワード上書きもしない＝冪等）。
    // パスワード再設定はリセット機能（LAP-005）に委ねる。
    update: {},
    create: {
      email,
      passwordHash,
      isAdmin: true,
      name: "Admin",
    },
  });

  console.log(`初期管理者を投入しました（冪等）: ${email}`);
}

// 直接実行されたときのみ main を走らせる（テストからの import では走らせない）。
// tsx/node で実行されると import.meta.url が argv[1] のパスと一致する。
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
