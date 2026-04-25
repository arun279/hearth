import type { InstanceOperator, User, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { addApprovedEmail } from "../src/use-cases/add-approved-email.ts";

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

describe("addApprovedEmail", () => {
  it("returns the created row on a fresh insert", async () => {
    const policy = makePolicy({
      addApprovedEmail: vi.fn(async () => ({
        approvedEmail: { email: "new@example.com", addedBy: actorId, addedAt: now, note: null },
        created: true,
      })),
    });
    const out = await addApprovedEmail(
      { actor: actorId, email: "new@example.com" },
      { users: makeUsers(), policy },
    );
    expect(out.email).toBe("new@example.com");
  });

  it("rejects with CONFLICT/already_exists on duplicate", async () => {
    const policy = makePolicy({
      addApprovedEmail: vi.fn(async () => ({
        approvedEmail: { email: "dup@example.com", addedBy: actorId, addedAt: now, note: null },
        created: false,
      })),
    });
    await expect(
      addApprovedEmail(
        { actor: actorId, email: "dup@example.com" },
        { users: makeUsers(), policy },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "already_exists" });
  });

  it("rejects a non-operator with FORBIDDEN/not_instance_operator", async () => {
    const policy = makePolicy({ getOperator: vi.fn(async () => null) });
    await expect(
      addApprovedEmail({ actor: actorId, email: "x@y" }, { users: makeUsers(), policy }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_instance_operator" });
  });

  it("rejects NOT_FOUND when actor user cannot be resolved", async () => {
    const policy = makePolicy({});
    const users: UserRepository = { ...makeUsers(), byId: vi.fn(async () => null) };
    await expect(
      addApprovedEmail({ actor: actorId, email: "x@y" }, { users, policy }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
