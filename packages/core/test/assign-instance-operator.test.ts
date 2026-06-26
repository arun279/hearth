import type { InstanceOperator, User, UserId } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { assignInstanceOperator } from "../src/use-cases/assign-instance-operator.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const actorId = "u_op" as UserId;
const targetId = "u_target" as UserId;

const user = (id: UserId, email: string): User => ({
  id,
  email,
  name: null,
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
});

const actorOp: InstanceOperator = {
  userId: actorId,
  grantedAt: now,
  grantedBy: actorId,
  revokedAt: null,
  revokedBy: null,
};

function makeUsers(targetUser: User | null): UserRepository {
  return {
    byId: vi.fn(async (id) => (id === actorId ? user(actorId, "op@example.com") : targetUser)),
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
    getOperator: vi.fn(async () => actorOp),
    isOperator: vi.fn(async () => true),
    listOperators: vi.fn(async () => []),
    addOperator: vi.fn(),
    revokeOperator: vi.fn(),
    countActiveOperators: vi.fn(async () => 1),
    bootstrapIfNeeded: vi.fn(),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

describe("assignInstanceOperator", () => {
  it("assigns when actor is operator and target user exists", async () => {
    const addOperator = vi.fn(async () => ({
      operator: {
        userId: targetId,
        grantedAt: now,
        grantedBy: actorId,
        revokedAt: null,
        revokedBy: null,
      } as InstanceOperator,
      created: true,
    }));
    const policy = makePolicy({ addOperator });
    const out = await assignInstanceOperator(
      { actor: actorId, target: targetId },
      { users: makeUsers(user(targetId, "t@example.com")), policy },
    );
    expect(out.operator.userId).toBe(targetId);
    expect(out.created).toBe(true);
    expect(addOperator).toHaveBeenCalledWith(targetId, actorId);
  });

  it("returns created=false on idempotent re-assign of an already-active operator", async () => {
    const addOperator = vi.fn(async () => ({
      operator: {
        userId: targetId,
        grantedAt: now,
        grantedBy: actorId,
        revokedAt: null,
        revokedBy: null,
      },
      created: false,
    }));
    const policy = makePolicy({ addOperator });
    const out = await assignInstanceOperator(
      { actor: actorId, target: targetId },
      { users: makeUsers(user(targetId, "t@example.com")), policy },
    );
    expect(out.operator.userId).toBe(targetId);
    expect(out.created).toBe(false);
  });

  it("rejects a non-operator with FORBIDDEN", async () => {
    const policy = makePolicy({ getOperator: vi.fn(async () => null) });
    await expect(
      assignInstanceOperator(
        { actor: actorId, target: targetId },
        { users: makeUsers(user(targetId, "t@example.com")), policy },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_instance_operator" });
  });

  it("rejects NOT_FOUND when the target user does not exist", async () => {
    const policy = makePolicy({});
    await expect(
      assignInstanceOperator(
        { actor: actorId, target: targetId },
        { users: makeUsers(null), policy },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
