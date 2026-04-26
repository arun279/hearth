import type {
  GroupInvitation,
  GroupMembership,
  StudyGroup,
  StudyGroupId,
  User,
  UserId,
} from "@hearth/domain";
import type {
  IdGenerator,
  InstanceAccessPolicyRepository,
  KillswitchGate,
  LearningTrackRepository,
  ObjectStorage,
  StudyGroupRepository,
  SystemFlagRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/bindings.ts";
import { createApiRouter } from "../src/index.ts";

type Ports = AppBindings["Variables"]["ports"];

function throwingProxy<T extends object>(label: string): T {
  return new Proxy({} as T, {
    get(_, key) {
      if (typeof key === "symbol") return undefined;
      return () => {
        throw new Error(`unexpected call: ${label}.${String(key)}`);
      };
    },
  });
}

function buildPorts(overrides: Partial<Ports>): Ports {
  return {
    policy: throwingProxy<InstanceAccessPolicyRepository>("policy"),
    settings: throwingProxy<Ports["settings"]>("settings"),
    users: throwingProxy<UserRepository>("users"),
    groups: throwingProxy<StudyGroupRepository>("groups"),
    tracks: throwingProxy<LearningTrackRepository>("tracks"),
    libraryItems: throwingProxy<Ports["libraryItems"]>("libraryItems"),
    activities: throwingProxy<Ports["activities"]>("activities"),
    records: throwingProxy<Ports["records"]>("records"),
    sessions: throwingProxy<Ports["sessions"]>("sessions"),
    storage: throwingProxy<ObjectStorage>("storage"),
    uploads: throwingProxy<UploadCoordinationRepository>("uploads"),
    flags: throwingProxy<SystemFlagRepository>("flags"),
    clock: { now: () => new Date("2026-04-22T00:00:00.000Z") },
    ids: { generate: () => "id_test" } as IdGenerator,
    ...overrides,
  };
}

function harness(opts: { userId: string | null; ports: Partial<Ports> }) {
  const gate: KillswitchGate = {
    getMode: async () => "normal",
    assertWritable: async () => {},
    invalidate: () => {},
  };
  const app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("userId", opts.userId);
    c.set("auth", { handler: async () => new Response(null) });
    c.set("gate", gate);
    c.set("adminToken", "a".repeat(64));
    c.set("writeLimiter", { limit: async () => ({ success: true }) });
    c.set("authLimiter", { limit: async () => ({ success: true }) });
    c.set("ports", buildPorts(opts.ports));
    await next();
  });
  app.route("/api/v1", createApiRouter());
  return app;
}

const now = new Date("2026-04-22T00:00:00.000Z");
const adminId = "u_admin" as UserId;
const targetId = "u_target" as UserId;
const gid = "g_1" as StudyGroupId;

const adminUser: User = {
  id: adminId,
  email: "admin@example.com",
  name: "Admin",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};
const targetUser: User = {
  ...adminUser,
  id: targetId,
  email: "target@example.com",
  name: "Target",
};

const group: StudyGroup = {
  id: gid,
  name: "G",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const baseMembership = (overrides: Partial<GroupMembership> = {}): GroupMembership => ({
  groupId: gid,
  userId: adminId,
  role: "admin",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
  ...overrides,
});

function makeGroupsPort(overrides: Partial<StudyGroupRepository> = {}): StudyGroupRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(async () => group),
    list: vi.fn(async () => []),
    listForUser: vi.fn(async () => [group]),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(async () => group),
    membership: vi.fn(async () => baseMembership()),
    membershipsForUser: vi.fn(async () => [baseMembership()]),
    listMemberships: vi.fn(async () => [baseMembership()]),
    listAdmins: vi.fn(async () => [baseMembership()]),
    countAdmins: vi.fn(async () => 2),
    addMembership: vi.fn(),
    removeMembership: vi.fn(),
    setMembershipRole: vi.fn(async () => baseMembership({ role: "participant" })),
    updateProfile: vi.fn(async () => baseMembership()),
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

function makeUsersPort(...users: User[]): UserRepository {
  const byId = new Map(users.map((u) => [u.id, u] as const));
  return {
    byId: vi.fn(async (id: UserId): Promise<User | null> => byId.get(id) ?? null),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

function makePolicyPort(
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

function makeTracksPort(): LearningTrackRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(),
    byGroup: vi.fn(),
    updateStatus: vi.fn(),
    enroll: vi.fn(),
    unenroll: vi.fn(),
    listEnrollments: vi.fn(async () => []),
    enrollment: vi.fn(),
    listFacilitators: vi.fn(async () => []),
    countFacilitators: vi.fn(async () => 0),
    endAllEnrollmentsForUser: vi.fn(async () => 0),
  } as LearningTrackRepository;
}

describe("M3 groups routes", () => {
  describe("GET /g/:groupId/members", () => {
    it("returns rows with capabilities", async () => {
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser),
          groups: makeGroupsPort(),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/members`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: unknown[] };
      expect(Array.isArray(body.entries)).toBe(true);
    });

    it("returns 404 for a non-member (no existence leak)", async () => {
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser),
          groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/members`);
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /g/:groupId/members/:userId", () => {
    it("removes a member when actor is admin", async () => {
      const removeMembership = vi.fn();
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser, targetUser),
          groups: makeGroupsPort({
            membership: vi.fn(async (_g, uid) =>
              uid === adminId
                ? baseMembership()
                : baseMembership({ userId: targetId, role: "participant" }),
            ),
            removeMembership,
          }),
          tracks: makeTracksPort(),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/members/${targetId}`, { method: "DELETE" });
      expect(res.status).toBe(204);
      expect(removeMembership).toHaveBeenCalled();
    });
  });

  describe("PATCH /g/:groupId/members/:userId/role", () => {
    it("demotes an admin", async () => {
      const setMembershipRole = vi.fn(async () =>
        baseMembership({ userId: targetId, role: "participant" }),
      );
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser, targetUser),
          groups: makeGroupsPort({
            membership: vi.fn(async (_g, uid) =>
              uid === adminId
                ? baseMembership()
                : baseMembership({ userId: targetId, role: "admin" }),
            ),
            setMembershipRole,
          }),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/members/${targetId}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "participant" }),
      });
      expect(res.status).toBe(200);
      expect(setMembershipRole).toHaveBeenCalled();
    });
  });

  describe("POST /g/:groupId/leave", () => {
    it("leaves the group", async () => {
      const removeMembership = vi.fn();
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser),
          groups: makeGroupsPort({
            membership: vi.fn(async () => baseMembership({ role: "participant" })),
            removeMembership,
            countAdmins: vi.fn(async () => 2),
          }),
          tracks: makeTracksPort(),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/leave`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(204);
      expect(removeMembership).toHaveBeenCalled();
    });
  });

  describe("POST /g/:groupId/invitations", () => {
    it("creates an invitation", async () => {
      const inv: GroupInvitation = {
        id: "i_1" as never,
        groupId: gid,
        trackId: null,
        token: "tok",
        email: "to@example.com",
        createdBy: adminId,
        createdAt: now,
        expiresAt: new Date(Date.now() + 1000),
        consumedAt: null,
        consumedBy: null,
        revokedAt: null,
        revokedBy: null,
      };
      const create = vi.fn(async () => inv);
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser),
          groups: makeGroupsPort({ createInvitation: create }),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "to@example.com" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { invitation: { token: string }; emailApproved: boolean };
      expect(body.invitation.token).toBeTruthy();
      expect(body.emailApproved).toBe(true);
    });
  });

  describe("DELETE /g/:groupId/invitations/:invitationId", () => {
    it("revokes the invitation", async () => {
      const inv: GroupInvitation = {
        id: "i_1" as never,
        groupId: gid,
        trackId: null,
        token: "tok",
        email: null,
        createdBy: adminId,
        createdAt: now,
        expiresAt: new Date(Date.now() + 1000),
        consumedAt: null,
        consumedBy: null,
        revokedAt: null,
        revokedBy: null,
      };
      const revoke = vi.fn();
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser),
          groups: makeGroupsPort({
            invitationById: vi.fn(async () => inv),
            revokeInvitation: revoke,
          }),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/invitations/i_1`, { method: "DELETE" });
      expect(res.status).toBe(204);
      expect(revoke).toHaveBeenCalled();
    });
  });

  describe("Avatar upload routes", () => {
    it("POST upload-request returns the presigned PUT", async () => {
      const presign = vi.fn(async () => ({
        url: "https://r2.example.com/avatars/u/g/k?sig",
        requiredHeaders: { "Content-Type": "image/png" },
      }));
      const createPending = vi.fn();
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser),
          groups: makeGroupsPort({
            membership: vi.fn(async () => baseMembership({ role: "participant" })),
          }),
          policy: makePolicyPort(),
          storage: { putUploadPresigned: presign } as unknown as ObjectStorage,
          uploads: { createPending } as unknown as UploadCoordinationRepository,
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/avatar/upload-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: "image/png", sizeBytes: 1000 }),
      });
      expect(res.status).toBe(201);
    });

    it("POST upload-request rejects oversized payloads", async () => {
      const app = harness({
        userId: adminId,
        ports: {
          users: makeUsersPort(adminUser),
          groups: makeGroupsPort({
            membership: vi.fn(async () => baseMembership()),
          }),
          policy: makePolicyPort(),
        },
      });
      const res = await app.request(`/api/v1/g/${gid}/avatar/upload-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: "image/png", sizeBytes: 600 * 1024 }),
      });
      expect(res.status).toBe(400);
    });
  });
});

describe("invitations routes", () => {
  it("GET /by-token/:token returns the preview", async () => {
    const app = harness({
      userId: null,
      ports: {
        groups: makeGroupsPort({
          invitationByToken: vi.fn(async () => ({
            id: "i_1" as never,
            groupId: gid,
            trackId: null,
            token: "tok",
            email: "t@x.com",
            createdBy: adminId,
            createdAt: now,
            expiresAt: new Date(Date.now() + 1000),
            consumedAt: null,
            consumedBy: null,
            revokedAt: null,
            revokedBy: null,
          })),
        }),
        policy: makePolicyPort(),
        settings: {
          get: vi.fn(async () => ({ name: "Hearth", updatedAt: now, updatedBy: null })),
          update: vi.fn(),
        } as unknown as AppBindings["Variables"]["ports"]["settings"],
      },
    });
    const res = await app.request("/api/v1/invitations/by-token/tok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { instanceName: string; groupName: string; status: string };
    expect(body.instanceName).toBe("Hearth");
    expect(body.groupName).toBe("G");
    expect(body.status).toBe("pending");
  });

  it("GET /by-token/:token returns 404 for unknown token", async () => {
    const app = harness({
      userId: null,
      ports: {
        groups: makeGroupsPort({ invitationByToken: vi.fn(async () => null) }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request("/api/v1/invitations/by-token/missing");
    expect(res.status).toBe(404);
  });

  it("POST /consume requires authentication", async () => {
    const app = harness({ userId: null, ports: {} });
    const res = await app.request("/api/v1/invitations/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "tok" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /consume creates a membership for an authenticated actor", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort({
          invitationByToken: vi.fn(async () => ({
            id: "i_1" as never,
            groupId: gid,
            trackId: null,
            token: "tok",
            email: "admin@example.com",
            createdBy: adminId,
            createdAt: now,
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: null,
            consumedBy: null,
            revokedAt: null,
            revokedBy: null,
          })),
          consumeInvitation: vi.fn(async () => ({
            membership: baseMembership(),
            enrollment: null,
          })),
        }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request("/api/v1/invitations/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "tok" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("M3 avatar finalize + profile", () => {
  it("PATCH profile updates the actor's row", async () => {
    const updateProfile = vi.fn(async () => baseMembership());
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort({
          membership: vi.fn(async () => baseMembership({ role: "participant" })),
          updateProfile,
        }),
        policy: makePolicyPort(),
        storage: { delete: vi.fn() } as unknown as ObjectStorage,
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/members/${adminId}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "Custom" }),
    });
    expect(res.status).toBe(200);
    expect(updateProfile).toHaveBeenCalled();
  });

  it("POST avatar/finalize verifies size and returns 200", async () => {
    const updateProfile = vi.fn(async () => baseMembership());
    const headObject = vi.fn(async () => ({ size: 1000, uploadedAt: now }));
    const deletePending = vi.fn();
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort({
          membership: vi.fn(async () => baseMembership({ role: "participant" })),
          updateProfile,
        }),
        policy: makePolicyPort(),
        storage: { headObject, delete: vi.fn() } as unknown as ObjectStorage,
        uploads: {
          getPending: vi.fn(async () => ({
            id: "upload-id-1",
            uploaderUserId: adminId,
            groupId: gid,
            context: "avatar" as const,
            storageKey: `avatars/${adminId}/${gid}/cuid-1`,
            declaredSizeBytes: 1000,
            declaredMimeType: "image/png",
            createdAt: now,
            expiresAt: new Date(Date.now() + 1000),
          })),
          deletePending,
        } as unknown as UploadCoordinationRepository,
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/avatar/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: "upload-id-1" }),
    });
    expect(res.status).toBe(200);
    expect(deletePending).toHaveBeenCalled();
  });

  it("GET invitations returns pending entries with status", async () => {
    const inv: GroupInvitation = {
      id: "i_1" as never,
      groupId: gid,
      trackId: null,
      token: "tok",
      email: "to@example.com",
      createdBy: adminId,
      createdAt: now,
      expiresAt: new Date(Date.now() + 1000),
      consumedAt: null,
      consumedBy: null,
      revokedAt: null,
      revokedBy: null,
    };
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort({
          listPendingInvitations: vi.fn(async () => [inv]),
        }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/invitations`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { status: string }[] };
    expect(body.entries[0]?.status).toBe("pending");
  });
});
