import type { GroupMembership, StudyGroupId, User, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { getMeContext } from "../src/use-cases/get-me-context.ts";

const uid = "u_1" as UserId;
const now = new Date("2026-04-22T00:00:00.000Z");

function makePolicy(
  overrides: Partial<InstanceAccessPolicyRepository> = {},
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
    countActiveOperators: vi.fn(async () => 0),
    bootstrapIfNeeded: vi.fn(),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

function makeUsers(user: User | null): UserRepository {
  return {
    byId: vi.fn(async () => user),
    byEmail: vi.fn(async () => user),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

function makeSettings(
  overrides: Partial<InstanceSettingsRepository> = {},
): InstanceSettingsRepository {
  return {
    get: async () => null,
    update: vi.fn(),
    ...overrides,
  };
}

function makeGroups(overrides: Partial<StudyGroupRepository> = {}): StudyGroupRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(async () => null),
    list: vi.fn(async () => []),
    listForUser: vi.fn(async () => []),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(),
    membership: vi.fn(async () => null),
    membershipsForUser: vi.fn(async () => []),
    countAdmins: vi.fn(async () => 0),
    counts: vi.fn(async () => ({ memberCount: 0, trackCount: 0, libraryItemCount: 0 })),
    ...overrides,
  };
}

const user: User = {
  id: uid,
  email: "op@example.com",
  name: "Op",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

describe("getMeContext", () => {
  it("returns anonymous envelope when userId is null", async () => {
    const ctx = await getMeContext(
      { userId: null },
      {
        users: makeUsers(null),
        policy: makePolicy({ countActiveOperators: vi.fn(async () => 0) }),
        settings: makeSettings({ get: async () => null }),
        groups: makeGroups(),
      },
    );
    expect(ctx.v).toBe(1);
    expect(ctx.data.user).toBeNull();
    expect(ctx.data.isOperator).toBe(false);
    expect(ctx.data.instance).toEqual({ name: "Hearth", needsBootstrap: true });
  });

  it("marks needsBootstrap=false once at least one operator exists", async () => {
    const ctx = await getMeContext(
      { userId: null },
      {
        users: makeUsers(null),
        policy: makePolicy({ countActiveOperators: vi.fn(async () => 1) }),
        settings: makeSettings({
          get: async () => ({ name: "Jolene's Hearth", updatedAt: now, updatedBy: null }),
        }),
        groups: makeGroups(),
      },
    );
    expect(ctx.data.instance).toEqual({ name: "Jolene's Hearth", needsBootstrap: false });
  });

  it("exposes isOperator=true when the authenticated user is an operator", async () => {
    const ctx = await getMeContext(
      { userId: uid },
      {
        users: makeUsers(user),
        policy: makePolicy({
          countActiveOperators: vi.fn(async () => 1),
          isOperator: vi.fn(async () => true),
        }),
        settings: makeSettings(),
        groups: makeGroups(),
      },
    );
    expect(ctx.data.user).toEqual({
      id: uid,
      email: "op@example.com",
      name: "Op",
      image: null,
    });
    expect(ctx.data.isOperator).toBe(true);
  });

  it("returns user=null when the stored email was scrubbed (defensive)", async () => {
    const ctx = await getMeContext(
      { userId: uid },
      {
        users: makeUsers({ ...user, email: null }),
        policy: makePolicy({ countActiveOperators: vi.fn(async () => 1) }),
        settings: makeSettings(),
        groups: makeGroups(),
      },
    );
    // A user row without an email (post-scrub) isn't exposable as MeContextUser.
    expect(ctx.data.user).toBeNull();
    // But the memberships/enrollments arrays still render empty so the shape
    // stays stable for the SPA consumer.
    expect(ctx.data.memberships).toEqual([]);
    expect(ctx.data.enrollments).toEqual([]);
  });

  it("populates memberships from the StudyGroupRepository", async () => {
    const gid = "g_42" as StudyGroupId;
    const membership: GroupMembership = {
      groupId: gid,
      userId: uid,
      role: "admin",
      joinedAt: now,
      removedAt: null,
    };
    const ctx = await getMeContext(
      { userId: uid },
      {
        users: makeUsers(user),
        policy: makePolicy({ countActiveOperators: vi.fn(async () => 1) }),
        settings: makeSettings(),
        groups: makeGroups({
          membershipsForUser: vi.fn(async () => [membership]),
        }),
      },
    );
    expect(ctx.data.memberships).toEqual([membership]);
  });
});
