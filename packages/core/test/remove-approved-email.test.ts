import type { InstanceOperator, User, UserId } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { removeApprovedEmail } from "../src/use-cases/remove-approved-email.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const actorId = "u_op" as UserId;

const actor: User = {
  id: actorId,
  email: "op@example.com",
  name: "Op",
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

function makeUsers(): UserRepository {
  return {
    byId: vi.fn(async () => actor),
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

describe("removeApprovedEmail", () => {
  it("delegates to the adapter which also performs session cleanup", async () => {
    const remove = vi.fn();
    const policy = makePolicy({ removeApprovedEmail: remove });
    await removeApprovedEmail(
      { actor: actorId, email: "guest@example.com" },
      { users: makeUsers(), policy },
    );
    expect(remove).toHaveBeenCalledWith("guest@example.com", actorId);
  });

  it("rejects a non-operator", async () => {
    const policy = makePolicy({ getOperator: vi.fn(async () => null) });
    await expect(
      removeApprovedEmail({ actor: actorId, email: "x@y" }, { users: makeUsers(), policy }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_instance_operator" });
  });
});
