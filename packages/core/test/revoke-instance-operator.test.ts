import type { InstanceOperator, User, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { revokeInstanceOperator } from "../src/use-cases/revoke-instance-operator.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const actorId = "u_actor" as UserId;
const targetId = "u_target" as UserId;

const actor: User = {
  id: actorId,
  email: "actor@example.com",
  name: "Actor",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const actorOp: InstanceOperator = {
  userId: actorId,
  grantedAt: now,
  grantedBy: actorId,
  revokedAt: null,
  revokedBy: null,
};

const targetOp: InstanceOperator = {
  userId: targetId,
  grantedAt: now,
  grantedBy: actorId,
  revokedAt: null,
  revokedBy: null,
};

function makeUsers(): UserRepository {
  return {
    byId: vi.fn(async (id) => (id === actorId ? actor : null)),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

function makePolicy(
  overrides: Partial<InstanceAccessPolicyRepository>,
): InstanceAccessPolicyRepository {
  return {
    isEmailApproved: vi.fn(async () => false),
    listApprovedEmails: vi.fn(async () => ({ entries: [], nextCursor: null })),
    addApprovedEmail: vi.fn(),
    removeApprovedEmail: vi.fn(),
    getApprovedEmail: vi.fn(async () => null),
    getOperator: vi.fn(async () => null),
    isOperator: vi.fn(async () => false),
    listOperators: vi.fn(async () => []),
    addOperator: vi.fn(),
    revokeOperator: vi.fn(),
    countActiveOperators: vi.fn(async () => 2),
    bootstrapIfNeeded: vi.fn(),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

describe("revokeInstanceOperator", () => {
  it("calls the adapter when actor is operator, target is active, and count > 1", async () => {
    const revoke = vi.fn();
    const policy = makePolicy({
      getOperator: vi.fn(async (id) => (id === actorId ? actorOp : targetOp)),
      countActiveOperators: vi.fn(async () => 2),
      revokeOperator: revoke,
    });
    await revokeInstanceOperator(
      { actor: actorId, target: targetId },
      { users: makeUsers(), policy },
    );
    expect(revoke).toHaveBeenCalledWith(targetId, actorId);
  });

  it("rejects with would_orphan_operator as an invariant violation when count == 1", async () => {
    const policy = makePolicy({
      getOperator: vi.fn(async (id) => (id === actorId ? actorOp : targetOp)),
      countActiveOperators: vi.fn(async () => 1),
    });
    await expect(
      revokeInstanceOperator({ actor: actorId, target: targetId }, { users: makeUsers(), policy }),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "would_orphan_operator" });
  });

  it("rejects a non-operator with FORBIDDEN/not_instance_operator", async () => {
    const policy = makePolicy({
      // Actor has no operator row; target is an active operator (so the
      // use case reaches the policy check rather than the NOT_FOUND branch).
      getOperator: vi.fn(async (id) => (id === targetId ? targetOp : null)),
    });
    await expect(
      revokeInstanceOperator({ actor: actorId, target: targetId }, { users: makeUsers(), policy }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_instance_operator" });
  });

  it("rejects self-revocation", async () => {
    const selfTarget: InstanceOperator = { ...actorOp };
    const policy = makePolicy({
      getOperator: vi.fn(async () => selfTarget),
      countActiveOperators: vi.fn(async () => 5),
    });
    await expect(
      revokeInstanceOperator({ actor: actorId, target: actorId }, { users: makeUsers(), policy }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "cannot_revoke_self" });
  });

  it("rejects when target is not currently an operator", async () => {
    const policy = makePolicy({
      getOperator: vi.fn(async (id) => (id === actorId ? actorOp : null)),
      countActiveOperators: vi.fn(async () => 2),
    });
    await expect(
      revokeInstanceOperator({ actor: actorId, target: targetId }, { users: makeUsers(), policy }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
