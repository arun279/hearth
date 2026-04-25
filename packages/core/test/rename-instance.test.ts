import type { InstanceOperator, InstanceSettings, User, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  UserRepository,
} from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { renameInstance } from "../src/use-cases/rename-instance.ts";

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

const settingsRow: InstanceSettings = {
  name: "Tuesday Night Learners",
  updatedAt: now,
  updatedBy: actorId,
};

function makeDeps(
  overrides: {
    policy?: Partial<InstanceAccessPolicyRepository>;
    settings?: Partial<InstanceSettingsRepository>;
    users?: Partial<UserRepository>;
  } = {},
) {
  const users: UserRepository = {
    byId: vi.fn(async () => actor),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
    ...overrides.users,
  };
  const policy: InstanceAccessPolicyRepository = {
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
    ...overrides.policy,
  } as InstanceAccessPolicyRepository;
  const settings: InstanceSettingsRepository = {
    get: vi.fn(async () => null),
    update: vi.fn(async () => settingsRow),
    ...overrides.settings,
  };
  return { users, policy, settings };
}

describe("renameInstance", () => {
  it("trims and returns the echoed settings row for an operator", async () => {
    const update = vi.fn(async () => settingsRow);
    const deps = makeDeps({ settings: { update } });
    const out = await renameInstance({ actor: actorId, name: "  Tuesday Night Learners  " }, deps);
    expect(update).toHaveBeenCalledWith({ name: "Tuesday Night Learners" }, actorId);
    expect(out).toEqual(settingsRow);
  });

  it("rejects names outside [1,80] as invariant violations", async () => {
    const deps = makeDeps();
    await expect(renameInstance({ actor: actorId, name: "" }, deps)).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
      reason: "invalid_instance_name",
    });
    await expect(
      renameInstance({ actor: actorId, name: "a".repeat(81) }, deps),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a non-operator", async () => {
    const deps = makeDeps({ policy: { getOperator: vi.fn(async () => null) } });
    await expect(renameInstance({ actor: actorId, name: "Anything" }, deps)).rejects.toMatchObject({
      code: "FORBIDDEN",
      reason: "not_instance_operator",
    });
  });
});
