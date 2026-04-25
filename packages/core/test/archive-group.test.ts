import type { GroupMembership, StudyGroup, StudyGroupId, User, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { archiveGroup } from "../src/use-cases/archive-group.ts";

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
    counts: vi.fn(async () => ({ memberCount: 1, trackCount: 0, libraryItemCount: 0 })),
    ...overrides,
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

describe("archiveGroup", () => {
  it("archives an active group when actor is current admin", async () => {
    const updateStatus = vi.fn();
    await archiveGroup(
      { actor: actorId, groupId },
      { users: makeUsers(actor), groups: makeGroups({ updateStatus }), policy: makePolicy() },
    );
    expect(updateStatus).toHaveBeenCalledWith(groupId, "archived", actorId);
  });

  it("rejects NOT_FOUND when actor doesn't exist", async () => {
    await expect(
      archiveGroup(
        { actor: actorId, groupId },
        { users: makeUsers(null), groups: makeGroups({}), policy: makePolicy() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects NOT_FOUND when group doesn't exist", async () => {
    await expect(
      archiveGroup(
        { actor: actorId, groupId },
        {
          users: makeUsers(actor),
          groups: makeGroups({ byId: vi.fn(async () => null) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects FORBIDDEN/not_group_admin for a non-admin", async () => {
    await expect(
      archiveGroup(
        { actor: actorId, groupId },
        {
          users: makeUsers(actor),
          groups: makeGroups({
            membership: vi.fn(
              async (): Promise<GroupMembership> => ({ ...adminMembership, role: "participant" }),
            ),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_group_admin" });
  });

  it("rejects NOT_FOUND/not_group_member for a non-member non-operator (no existence leak)", async () => {
    await expect(
      archiveGroup(
        { actor: actorId, groupId },
        {
          users: makeUsers(actor),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_group_member" });
  });

  it("is a no-op on an already-archived group (idempotent retry)", async () => {
    const updateStatus = vi.fn();
    await archiveGroup(
      { actor: actorId, groupId },
      {
        users: makeUsers(actor),
        groups: makeGroups({
          byId: vi.fn(async (): Promise<StudyGroup> => ({ ...activeGroup, status: "archived" })),
          updateStatus,
        }),
        policy: makePolicy(),
      },
    );
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
