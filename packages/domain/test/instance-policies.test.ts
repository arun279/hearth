import { describe, expect, it } from "vitest";
import type { UserId } from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import {
  canAddApprovedEmail,
  canAssignInstanceOperator,
  canRemoveApprovedEmail,
  canRenameInstance,
  canRevokeInstanceOperator,
} from "../src/policy/index.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const uid = "u_actor" as UserId;
const targetUid = "u_target" as UserId;

const actor: User = {
  id: uid,
  email: "actor@example.com",
  name: "Actor",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const opForActor: InstanceOperator = {
  userId: uid,
  grantedAt: now,
  grantedBy: uid,
  revokedAt: null,
  revokedBy: null,
};

const revokedOpForActor: InstanceOperator = { ...opForActor, revokedAt: now };

const targetActiveOp: InstanceOperator = {
  userId: targetUid,
  grantedAt: now,
  grantedBy: uid,
  revokedAt: null,
  revokedBy: null,
};

describe("canAddApprovedEmail", () => {
  it("allows an active operator", () => {
    expect(canAddApprovedEmail(actor, opForActor).ok).toBe(true);
  });
  it("denies when actor has no operator row", () => {
    const r = canAddApprovedEmail(actor, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
  it("denies when actor's operator row is revoked", () => {
    const r = canAddApprovedEmail(actor, revokedOpForActor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
});

describe("canRemoveApprovedEmail", () => {
  it("allows an active operator", () => {
    expect(canRemoveApprovedEmail(actor, opForActor).ok).toBe(true);
  });
  it("denies a non-operator", () => {
    const r = canRemoveApprovedEmail(actor, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
});

describe("canRenameInstance", () => {
  it("allows an active operator", () => {
    expect(canRenameInstance(actor, opForActor).ok).toBe(true);
  });
  it("denies a non-operator", () => {
    const r = canRenameInstance(actor, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
});

describe("canAssignInstanceOperator", () => {
  it("allows an active operator", () => {
    expect(canAssignInstanceOperator(actor, opForActor).ok).toBe(true);
  });
  it("denies a non-operator", () => {
    const r = canAssignInstanceOperator(actor, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
});

describe("canRevokeInstanceOperator", () => {
  it("allows when actor is operator and target is someone else and count > 1", () => {
    expect(canRevokeInstanceOperator(actor, opForActor, targetActiveOp, 2).ok).toBe(true);
  });
  it("denies non-operators", () => {
    const r = canRevokeInstanceOperator(actor, null, targetActiveOp, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
  it("denies self-revocation", () => {
    const selfTarget: InstanceOperator = { ...opForActor };
    const r = canRevokeInstanceOperator(actor, opForActor, selfTarget, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("cannot_revoke_self");
  });
  it("denies when target's operator row is already revoked", () => {
    const alreadyRevoked: InstanceOperator = { ...targetActiveOp, revokedAt: now };
    const r = canRevokeInstanceOperator(actor, opForActor, alreadyRevoked, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("already_revoked");
  });
  it("denies when revocation would leave zero active operators", () => {
    const r = canRevokeInstanceOperator(actor, opForActor, targetActiveOp, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("would_orphan_operator");
  });
  it("orphan check uses the active count, not the total", () => {
    // A count of 2 with target active means removing target leaves 1 — still allowed.
    expect(canRevokeInstanceOperator(actor, opForActor, targetActiveOp, 2).ok).toBe(true);
  });
});
