import type { GroupMembership, StudyGroup, StudyGroupId, User, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { updateGroupMetadata } from "../src/use-cases/update-group-metadata.ts";

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
  name: "Old name",
  description: "Old desc",
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
    updateMetadata: vi.fn(async () => activeGroup),
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

describe("updateGroupMetadata", () => {
  it("trims and forwards the patch", async () => {
    const updateMetadata = vi.fn(async () => ({ ...activeGroup, name: "New" }));
    await updateGroupMetadata(
      { actor: actorId, groupId, name: "  New  " },
      { users: makeUsers(actor), groups: makeGroups({ updateMetadata }), policy: makePolicy() },
    );
    expect(updateMetadata).toHaveBeenCalledWith(groupId, { name: "New" }, actorId);
  });

  it("collapses an empty-string description to null", async () => {
    const updateMetadata = vi.fn(async () => activeGroup);
    await updateGroupMetadata(
      { actor: actorId, groupId, description: "   " },
      { users: makeUsers(actor), groups: makeGroups({ updateMetadata }), policy: makePolicy() },
    );
    expect(updateMetadata).toHaveBeenCalledWith(groupId, { description: null }, actorId);
  });

  it("propagates an explicit-null description", async () => {
    const updateMetadata = vi.fn(async () => activeGroup);
    await updateGroupMetadata(
      { actor: actorId, groupId, description: null },
      { users: makeUsers(actor), groups: makeGroups({ updateMetadata }), policy: makePolicy() },
    );
    expect(updateMetadata).toHaveBeenCalledWith(groupId, { description: null }, actorId);
  });

  it("rejects when neither name nor description is provided", async () => {
    await expect(
      updateGroupMetadata(
        { actor: actorId, groupId },
        { users: makeUsers(actor), groups: makeGroups({}), policy: makePolicy() },
      ),
    ).rejects.toMatchObject({ reason: "no_metadata_provided" });
  });

  it("rejects FORBIDDEN/not_group_admin for a non-admin member", async () => {
    await expect(
      updateGroupMetadata(
        { actor: actorId, groupId, name: "New" },
        {
          users: makeUsers(actor),
          groups: makeGroups({
            membership: vi.fn(
              async (): Promise<GroupMembership> => ({
                ...adminMembership,
                role: "participant",
              }),
            ),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_group_admin" });
  });

  it("rejects FORBIDDEN/group_archived on archived groups", async () => {
    await expect(
      updateGroupMetadata(
        { actor: actorId, groupId, name: "New" },
        {
          users: makeUsers(actor),
          groups: makeGroups({
            byId: vi.fn(async () => ({ ...activeGroup, status: "archived" }) as StudyGroup),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "group_archived" });
  });

  it("rejects NOT_FOUND/not_group_member for a non-member non-operator (no existence leak)", async () => {
    await expect(
      updateGroupMetadata(
        { actor: actorId, groupId, name: "New" },
        {
          users: makeUsers(actor),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_group_member" });
  });
});
