import type { InstanceOperator, StudyGroup, StudyGroupId, User, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { createStudyGroup } from "../src/use-cases/create-study-group.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const opId = "u_op" as UserId;

const operator: User = {
  id: opId,
  email: "op@x.com",
  name: "Op",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const opRow: InstanceOperator = {
  userId: opId,
  grantedAt: now,
  grantedBy: opId,
  revokedAt: null,
  revokedBy: null,
};

const created: StudyGroup = {
  id: "g_new" as StudyGroupId,
  name: "Tuesday Night Learners",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

function makeUsers(user: User | null): UserRepository {
  return {
    byId: vi.fn(async () => user),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

function makePolicy(
  overrides: Partial<InstanceAccessPolicyRepository> = {},
): InstanceAccessPolicyRepository {
  return {
    isEmailApproved: vi.fn(),
    listApprovedEmails: vi.fn(),
    addApprovedEmail: vi.fn(),
    removeApprovedEmail: vi.fn(),
    getApprovedEmail: vi.fn(),
    getOperator: vi.fn(async () => opRow),
    isOperator: vi.fn(async () => true),
    listOperators: vi.fn(),
    addOperator: vi.fn(),
    revokeOperator: vi.fn(),
    countActiveOperators: vi.fn(async () => 1),
    bootstrapIfNeeded: vi.fn(),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

function makeGroups(overrides: Partial<StudyGroupRepository> = {}): StudyGroupRepository {
  return {
    create: vi.fn(async () => created),
    byId: vi.fn(async () => created),
    list: vi.fn(async () => []),
    listForUser: vi.fn(async () => []),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(),
    membership: vi.fn(async () => null),
    membershipsForUser: vi.fn(async () => []),
    countAdmins: vi.fn(async () => 1),
    counts: vi.fn(async () => ({ memberCount: 1, trackCount: 0, libraryItemCount: 0 })),
    ...overrides,
  };
}

describe("createStudyGroup", () => {
  it("creates a group when actor is an active operator", async () => {
    const create = vi.fn(async () => created);
    const out = await createStudyGroup(
      { actor: opId, name: "Tuesday Night Learners" },
      { users: makeUsers(operator), policy: makePolicy(), groups: makeGroups({ create }) },
    );
    expect(out).toEqual(created);
    expect(create).toHaveBeenCalledWith({
      name: "Tuesday Night Learners",
      description: undefined,
      createdBy: opId,
    });
  });

  it("trims whitespace from name and description", async () => {
    const create = vi.fn(async () => created);
    await createStudyGroup(
      { actor: opId, name: "  Tuesday  ", description: "  Small group  " },
      { users: makeUsers(operator), policy: makePolicy(), groups: makeGroups({ create }) },
    );
    expect(create).toHaveBeenCalledWith({
      name: "Tuesday",
      description: "Small group",
      createdBy: opId,
    });
  });

  it("rejects FORBIDDEN/not_instance_operator for a non-operator", async () => {
    await expect(
      createStudyGroup(
        { actor: opId, name: "G" },
        {
          users: makeUsers(operator),
          policy: makePolicy({ getOperator: vi.fn(async () => null) }),
          groups: makeGroups(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_instance_operator" });
  });

  it("rejects FORBIDDEN/not_instance_operator for a revoked operator", async () => {
    await expect(
      createStudyGroup(
        { actor: opId, name: "G" },
        {
          users: makeUsers(operator),
          policy: makePolicy({ getOperator: vi.fn(async () => ({ ...opRow, revokedAt: now })) }),
          groups: makeGroups(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_instance_operator" });
  });

  it("rejects an empty name", async () => {
    await expect(
      createStudyGroup(
        { actor: opId, name: "   " },
        { users: makeUsers(operator), policy: makePolicy(), groups: makeGroups() },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_group_name" });
  });

  it("rejects an over-long name", async () => {
    await expect(
      createStudyGroup(
        { actor: opId, name: "x".repeat(121) },
        { users: makeUsers(operator), policy: makePolicy(), groups: makeGroups() },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_group_name" });
  });

  it("rejects an over-long description", async () => {
    await expect(
      createStudyGroup(
        { actor: opId, name: "G", description: "x".repeat(2001) },
        { users: makeUsers(operator), policy: makePolicy(), groups: makeGroups() },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_group_description" });
  });

  it("rejects NOT_FOUND when the actor row is missing", async () => {
    await expect(
      createStudyGroup(
        { actor: opId, name: "G" },
        { users: makeUsers(null), policy: makePolicy(), groups: makeGroups() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
