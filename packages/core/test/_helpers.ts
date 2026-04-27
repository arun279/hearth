import type {
  GroupInvitation,
  GroupMembership,
  InvitationId,
  StudyGroup,
  StudyGroupId,
  User,
  UserId,
} from "@hearth/domain";
import type {
  IdGenerator,
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  ObjectStorage,
  StudyGroupRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";
import { vi } from "vitest";

/**
 * Shared fixtures + repository fakes for the M3 use-case tests. Each
 * `make*` helper returns a port with vitest-mocked methods; tests
 * override the fields they care about and let the rest fall through to
 * sensible defaults.
 */

export const TEST_NOW = new Date("2026-04-22T00:00:00.000Z");
export const ACTOR_ID = "u_actor" as UserId;
export const TARGET_ID = "u_target" as UserId;
export const GROUP_ID = "g_1" as StudyGroupId;
export const INVITE_ID = "i_1" as InvitationId;

export const ACTOR: User = {
  id: ACTOR_ID,
  email: "actor@example.com",
  name: "Actor",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

export const TARGET: User = {
  ...ACTOR,
  id: TARGET_ID,
  email: "target@example.com",
  name: "Target",
};

export const ACTIVE_GROUP: StudyGroup = {
  id: GROUP_ID,
  name: "Active Group",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

export const ARCHIVED_GROUP: StudyGroup = {
  ...ACTIVE_GROUP,
  status: "archived",
  archivedAt: TEST_NOW,
};

export function membership(overrides: Partial<GroupMembership> = {}): GroupMembership {
  return {
    groupId: GROUP_ID,
    userId: ACTOR_ID,
    role: "participant",
    joinedAt: TEST_NOW,
    removedAt: null,
    removedBy: null,
    attributionOnLeave: null,
    displayNameSnapshot: null,
    profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
    ...overrides,
  };
}

export function invitation(overrides: Partial<GroupInvitation> = {}): GroupInvitation {
  return {
    id: INVITE_ID,
    groupId: GROUP_ID,
    trackId: null,
    token: "tok-test",
    email: "target@example.com",
    createdBy: ACTOR_ID,
    createdAt: TEST_NOW,
    expiresAt: new Date(TEST_NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
    consumedAt: null,
    consumedBy: null,
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  };
}

export function makeUsers(...users: ReadonlyArray<User>): UserRepository {
  const byId = new Map<UserId, User>(users.map((u): [UserId, User] => [u.id, u]));
  const byEmail = new Map<string, User>(
    users
      .filter((u): u is User & { email: string } => u.email !== null)
      .map((u): [string, User] => [u.email.toLowerCase(), u]),
  );
  return {
    byId: vi.fn(async (id: UserId): Promise<User | null> => byId.get(id) ?? null),
    byEmail: vi.fn(
      async (email: string): Promise<User | null> => byEmail.get(email.toLowerCase()) ?? null,
    ),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

export function makeGroups(overrides: Partial<StudyGroupRepository> = {}): StudyGroupRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(async () => ACTIVE_GROUP),
    list: vi.fn(async () => []),
    listForUser: vi.fn(async () => []),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(),
    membership: vi.fn(async () => membership({ role: "admin" })),
    membershipsForUser: vi.fn(async () => []),
    listMemberships: vi.fn(async () => []),
    listAdmins: vi.fn(async () => []),
    countAdmins: vi.fn(async () => 2),
    addMembership: vi.fn(),
    removeMembership: vi.fn(),
    setMembershipRole: vi.fn(),
    updateProfile: vi.fn(),
    createInvitation: vi.fn(),
    invitationByToken: vi.fn(),
    invitationById: vi.fn(),
    listPendingInvitations: vi.fn(async () => []),
    revokeInvitation: vi.fn(),
    consumeInvitation: vi.fn(),
    counts: vi.fn(async () => ({ memberCount: 1, trackCount: 0, libraryItemCount: 0 })),
    ...overrides,
  };
}

export function makePolicy(
  overrides: Partial<InstanceAccessPolicyRepository> = {},
): InstanceAccessPolicyRepository {
  return {
    isEmailApproved: vi.fn(async () => true),
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

export function makeTracks(
  overrides: Partial<LearningTrackRepository> = {},
): LearningTrackRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(),
    byGroup: vi.fn(async () => []),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(),
    saveStructure: vi.fn(),
    saveContributionPolicy: vi.fn(),
    loadStructure: vi.fn(async () => ({ v: 1, data: { mode: "free" } })),
    loadContributionPolicy: vi.fn(async () => ({ v: 1, data: { mode: "direct" } })),
    enrollment: vi.fn(async () => null),
    listFacilitators: vi.fn(async () => []),
    countFacilitators: vi.fn(async () => 0),
    countEnrollments: vi.fn(async () => 0),
    endAllEnrollmentsForUser: vi.fn(async () => 0),
    ...overrides,
  } as LearningTrackRepository;
}

export function makeStorage(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  return {
    putUpload: vi.fn(),
    putUploadPresigned: vi.fn(async () => ({
      url: "https://r2.example.com/avatars/u/g/k?sig",
      requiredHeaders: { "Content-Type": "image/png" },
    })),
    getDownloadUrl: vi.fn(),
    headObject: vi.fn(),
    delete: vi.fn(),
    usedBytes: vi.fn(async () => 0),
    ...overrides,
  };
}

export function makeUploads(
  overrides: Partial<UploadCoordinationRepository> = {},
): UploadCoordinationRepository {
  return {
    createPending: vi.fn(),
    getPending: vi.fn(),
    deletePending: vi.fn(),
    ...overrides,
  };
}

export function makeIds(values: ReadonlyArray<string>): IdGenerator {
  let i = 0;
  return {
    generate: vi.fn(() => values[i++ % values.length] ?? `id_${i}`),
  };
}
