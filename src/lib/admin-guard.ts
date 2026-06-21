// 管理者フラグ変更の可否を判定する純関数（LAP-004 §3-2）。
// 副作用なし・DB 非依存。server action の DB アクセス前プリチェックとして使い、
// 同じロジックを単体テスト（admin-guard.test.ts）で検証する。
//
// 多層防御の一翼であり、最後の管理者保護の「正」は §3-3 の条件付き原子 UPDATE。
// 本関数は早期拒否とロジック中心化のための層に過ぎない。

export type AdminAction = "grant" | "revoke";

export type AdminGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: "forbidden" | "self_demotion" | "last_admin" | "target_not_found";
    };

/**
 * 管理者フラグ変更の可否を判定する。判定順は §3-2:
 *   1. 操作者が非管理者 → forbidden（認可）
 *   2. 対象が存在しない → target_not_found
 *   3. revoke のとき:
 *      - 操作者 id == 対象 id → self_demotion（自己降格不可）
 *      - 対象が管理者かつ他に管理者が居ない → last_admin（最後の管理者保護）
 *   4. それ以外 → ok（grant、または既に望む状態なら呼び出し側で no-op 扱い）
 */
export function evaluateAdminFlagChange(input: {
  actorIsAdmin: boolean; // 操作者が管理者か（認可）
  actorId: string; // 操作者 id
  targetId: string; // 対象 id
  targetExists: boolean; // 対象が存在するか
  targetIsAdmin: boolean; // 対象の現在 isAdmin
  action: AdminAction; // grant / revoke
  otherAdminExists: boolean; // 対象以外に isAdmin=true が存在するか
}): AdminGuardResult {
  // 1. 認可: 操作者が管理者でなければ拒否。
  if (!input.actorIsAdmin) {
    return { ok: false, reason: "forbidden" };
  }

  // 2. 対象不在。
  if (!input.targetExists) {
    return { ok: false, reason: "target_not_found" };
  }

  // 3. 剥奪固有のガード。
  if (input.action === "revoke") {
    // 自己降格不可。
    if (input.actorId === input.targetId) {
      return { ok: false, reason: "self_demotion" };
    }
    // 最後の管理者保護（対象が管理者かつ他に管理者が居ない）。
    if (input.targetIsAdmin && !input.otherAdminExists) {
      return { ok: false, reason: "last_admin" };
    }
  }

  // 4. grant、または問題のない revoke。
  return { ok: true };
}
