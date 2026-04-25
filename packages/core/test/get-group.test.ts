import type {
  GroupMembership,
  InstanceOperator,
  StudyGroup,
  StudyGroupId,
  User,
  UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { getGroup } from "../src/use-cases/get-group.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const actorId = "u_actor" as UserId;
const groupId = "g_1" as StudyGroupId;

const actor: User = {
  id: actorId,
  email: "u@x.com",
  name: null,
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const activeGroup: StudyGroup = {
  id: groupId,
  name: "G",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const adminMembership: GroupMembership = {
  groupId,
  userId: actorId,
  role: "admin",
  joinedAt: now,
  removedAt: null,
};

const operator: InstanceOperator = {
  userId: actorId,
  grantedAt: now,
  grantedBy: actorId,
  revokedAt: null,
  revokedBy: null,
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
    getOperator: vi.fn(async () => null),
    isOperator: vi.fn(async () => false),
    listOperators: vi.fn(),
    addOperator: vi.fn(),
    revokeOperator: vi.fn(),
    countActiveOperators: vi.fn(async () => 1),
    bootstrapIfNeeded: vi.fn(),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

function makeGroups(overrides: Partial<StudyGroupRepository>): StudyGroupRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(async () => activeGroup),
    list: vi.fn(async () => []),
    listForUser: vi.fn(async () => []),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(),
    membership: vi.fn(async () => adminMembership),
    membershipsForUser: vi.fn(async () => []),
    countAdmins: vi.fn(async () => 1),
    counts: vi.fn(async () => ({ memberCount: 3, trackCount: 1, libraryItemCount: 4 })),
    ...overrides,
  };
}

describe("getGroup", () => {
  it("returns group + caps for a current admin", async () => {
    const out = await getGroup(
      { actor: actorId, groupId },
      { users: makeUsers(actor), policy: makePolicy(), groups: makeGroups({}) },
    );
    expect(out.group).toEqual(activeGroup);
    expect(out.myMembership).toEqual(adminMembership);
    expect(out.counts).toEqual({ memberCount: 3, trackCount: 1, libraryItemCount: 4 });
    expect(out.caps).toEqual({
      canArchive: true,
      canUnarchive: true,
      canUpdateMetadata: true,
    });
  });

  it("returns caps with canUpdateMetadata=false for an archived group", async () => {
    const out = await getGroup(
      { actor: actorId, groupId },
      {
        users: makeUsers(actor),
        policy: makePolicy(),
        groups: makeGroups({
          byId: vi.fn(async (): Promise<StudyGroup> => ({ ...activeGroup, status: "archived" })),
        }),
      },
    );
    expect(out.caps.canUpdateMetadata).toBe(false);
    expect(out.caps.canUnarchive).toBe(true);
  });

  it("returns NOT_FOUND for a non-member non-operator (404, not 403)", async () => {
    await expect(
      getGroup(
        { actor: actorId, groupId },
        {
          users: makeUsers(actor),
          policy: makePolicy(),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_group_member" });
  });

  it("allows an active operator who is not a member", async () => {
    const out = await getGroup(
      { actor: actorId, groupId },
      {
        users: makeUsers(actor),
        policy: makePolicy({ getOperator: vi.fn(async () => operator) }),
        groups: makeGroups({ membership: vi.fn(async () => null) }),
      },
    );
    expect(out.group).toEqual(activeGroup);
    expect(out.myMembership).toBeNull();
    // Operator who is not a member cannot mutate; caps reflect that.
    expect(out.caps.canUpdateMetadata).toBe(false);
    expect(out.caps.canArchive).toBe(false);
  });

  it("returns NOT_FOUND when group does not exist", async () => {
    await expect(
      getGroup(
        { actor: actorId, groupId },
        {
          users: makeUsers(actor),
          policy: makePolicy(),
          groups: makeGroups({ byId: vi.fn(async () => null) }),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
