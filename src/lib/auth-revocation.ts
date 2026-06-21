import { prisma } from "@/lib/prisma";

// 失効バージョンを上げる単一の I/F（LAP-002 §4 / §6）。
// このチケットでは「置き場所と関数定義」のみ提供し、呼び出し元は実装しない。
//   - LAP-003: 招待取り消し時に対象ユーザーがいれば呼ぶ
//   - LAP-004: 管理者によるフラグ変更・強制ログアウト時に呼ぶ
// sessionVersion を increment すると、対象ユーザーの既存 JWT cookie は
// 次回アクセスの jwt callback 照合で弾かれる（cookie 期限前でも即時無効化相当）。

/**
 * 指定ユーザーの sessionVersion を 1 増やし、既存セッションを失効させる。
 * @param userId 対象ユーザーの id
 */
export async function bumpSessionVersion(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}
