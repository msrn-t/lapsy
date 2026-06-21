import { describe, it, expect } from "vitest";
import { evaluateAdminFlagChange } from "./admin-guard";

// LAP-004 §9 のテスト対象。純関数 evaluateAdminFlagChange の
// 認可・自己降格不可・最後の管理者保護・対象不在を検証する。

// 既定の入力（他に管理者が居て、対象が存在する管理者・revoke）。
const base = {
  actorIsAdmin: true,
  actorId: "actor-1",
  targetId: "target-1",
  targetExists: true,
  targetIsAdmin: true,
  action: "revoke" as const,
  otherAdminExists: true,
};

describe("evaluateAdminFlagChange（管理者フラグ変更ガード）", () => {
  it("非管理者の操作は forbidden（認可は最優先で判定）", () => {
    // 対象不在など他の拒否条件を併せても forbidden が優先される。
    expect(
      evaluateAdminFlagChange({
        ...base,
        actorIsAdmin: false,
        targetExists: false,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("対象が存在しなければ target_not_found", () => {
    expect(
      evaluateAdminFlagChange({ ...base, targetExists: false }),
    ).toEqual({ ok: false, reason: "target_not_found" });
  });

  it("自己剥奪（actorId==targetId かつ revoke）は self_demotion", () => {
    expect(
      evaluateAdminFlagChange({
        ...base,
        targetId: "actor-1",
        action: "revoke",
      }),
    ).toEqual({ ok: false, reason: "self_demotion" });
  });

  it("最後の管理者の剥奪（対象が管理者・他に管理者なし）は last_admin", () => {
    expect(
      evaluateAdminFlagChange({
        ...base,
        targetIsAdmin: true,
        otherAdminExists: false,
        action: "revoke",
      }),
    ).toEqual({ ok: false, reason: "last_admin" });
  });

  it("他に管理者が居る状態での剥奪は ok", () => {
    expect(
      evaluateAdminFlagChange({
        ...base,
        otherAdminExists: true,
        action: "revoke",
      }),
    ).toEqual({ ok: true });
  });

  it("付与（grant・他ユーザー）は ok", () => {
    expect(
      evaluateAdminFlagChange({
        ...base,
        targetIsAdmin: false,
        action: "grant",
      }),
    ).toEqual({ ok: true });
  });

  it("自己付与（actorId==targetId かつ grant）は ok（自己降格不可は剥奪のみ）", () => {
    expect(
      evaluateAdminFlagChange({
        ...base,
        targetId: "actor-1",
        targetIsAdmin: false,
        action: "grant",
      }),
    ).toEqual({ ok: true });
  });

  it("対象が非管理者の剥奪でも他に管理者が居れば ok（最後の管理者判定は対象が管理者のときのみ）", () => {
    expect(
      evaluateAdminFlagChange({
        ...base,
        targetIsAdmin: false,
        otherAdminExists: false,
        action: "revoke",
      }),
    ).toEqual({ ok: true });
  });
});
