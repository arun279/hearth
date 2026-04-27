import type {
  ContributionPolicyEnvelope,
  GroupMembership,
  LearningTrack,
  LearningTrackId,
  StudyGroup,
  StudyGroupId,
  TrackEnrollment,
  TrackStructureEnvelope,
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
const strangerId = "u_str" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;

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

const strangerUser: User = {
  ...adminUser,
  id: strangerId,
  email: "str@example.com",
  name: "Stranger",
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

const baseTrack = (overrides: Partial<LearningTrack> = {}): LearningTrack => ({
  id: tid,
  groupId: gid,
  name: "Track 1",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const facilitatorEnrollment: TrackEnrollment = {
  trackId: tid,
  userId: adminId,
  role: "facilitator",
  enrolledAt: now,
  leftAt: null,
};

const emptyStructure: TrackStructureEnvelope = { v: 1, data: { mode: "free" } };
const directPolicy: ContributionPolicyEnvelope = { v: 1, data: { mode: "direct" } };

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
  } as StudyGroupRepository;
}

function makeTracksPort(overrides: Partial<LearningTrackRepository> = {}): LearningTrackRepository {
  return {
    create: vi.fn(async () => baseTrack()),
    byId: vi.fn(async () => baseTrack()),
    byGroup: vi.fn(async () => [baseTrack()]),
    updateStatus: vi.fn(async () => baseTrack()),
    updateMetadata: vi.fn(async () => baseTrack()),
    saveStructure: vi.fn(async () => baseTrack()),
    saveContributionPolicy: vi.fn(async () => baseTrack()),
    loadStructure: vi.fn(async () => emptyStructure),
    loadContributionPolicy: vi.fn(async () => directPolicy),
    enrollment: vi.fn(async () => facilitatorEnrollment),
    listFacilitators: vi.fn(async () => [facilitatorEnrollment]),
    countFacilitators: vi.fn(async () => 1),
    countEnrollments: vi.fn(async () => 3),
    endAllEnrollmentsForUser: vi.fn(async () => 0),
    ...overrides,
  } as LearningTrackRepository;
}

describe("POST /api/v1/g/:groupId/tracks (createTrack)", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = harness({ userId: null, ports: {} });
    const res = await app.request(`/api/v1/g/${gid}/tracks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "T" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has empty name", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/tracks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 with the new track when admin creates one", async () => {
    const created = baseTrack({ name: "New Track" });
    const create = vi.fn(async () => created);
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ create }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/tracks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Track", description: "Desc" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe("New Track");
    expect(create).toHaveBeenCalled();
  });

  it("returns 403 when actor is not a Group Admin", async () => {
    const create = vi.fn();
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort({
          membership: vi.fn(async () => baseMembership({ role: "participant" })),
        }),
        tracks: makeTracksPort({ create }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/tracks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "T" }),
    });
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 404 when the group does not exist", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort({ byId: vi.fn(async () => null) }),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/tracks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "T" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/g/:groupId/tracks (listTracksInGroup)", () => {
  it("returns 200 with entries", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ byGroup: vi.fn(async () => [baseTrack(), baseTrack()]) }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/tracks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(2);
  });

  it("returns 404 for a non-member", async () => {
    const app = harness({
      userId: strangerId,
      ports: {
        users: makeUsersPort(strangerUser),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/tracks`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/tracks/:trackId (getTrack)", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = harness({ userId: null, ports: {} });
    const res = await app.request(`/api/v1/tracks/${tid}`);
    expect(res.status).toBe(401);
  });

  it("returns 200 with the track-home payload", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      track: { id: string };
      group: { id: string; name: string; status: string };
      structure: TrackStructureEnvelope;
      contributionPolicy: ContributionPolicyEnvelope;
      caps: { canEditMetadata: boolean };
    };
    expect(body.track.id).toBe(tid);
    expect(body.group.id).toBe(gid);
    expect(body.structure.data.mode).toBe("free");
    expect(body.contributionPolicy.data.mode).toBe("direct");
    expect(body.caps.canEditMetadata).toBe(true);
  });

  it("returns 404 for a non-member (existence not leaked)", async () => {
    const app = harness({
      userId: strangerId,
      ports: {
        users: makeUsersPort(strangerUser),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
        tracks: makeTracksPort({ enrollment: vi.fn(async () => null) }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the track id is unknown", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ byId: vi.fn(async () => null) }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/tracks/:trackId (updateTrackMetadata)", () => {
  it("returns 200 on successful update", async () => {
    const updated = baseTrack({ name: "Renamed" });
    const updateMetadata = vi.fn(async () => updated);
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ updateMetadata }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed", description: "new desc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Renamed");
    expect(updateMetadata).toHaveBeenCalled();
  });

  it("accepts a description-only patch with description: null (clear)", async () => {
    const updateMetadata = vi.fn(async () => baseTrack({ description: null }));
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ updateMetadata }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: null }),
    });
    expect(res.status).toBe(200);
    expect(updateMetadata).toHaveBeenCalled();
  });

  it("returns 400 on an empty body", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when policy denies (participant)", async () => {
    const updateMetadata = vi.fn();
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort({
          membership: vi.fn(async () => baseMembership({ role: "participant" })),
        }),
        tracks: makeTracksPort({
          enrollment: vi.fn(async () => null),
          updateMetadata,
        }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(403);
    expect(updateMetadata).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/tracks/:trackId/status (status dispatch)", () => {
  it("pauses an active track", async () => {
    const updateStatus = vi.fn(async () => baseTrack({ status: "paused", pausedAt: now }));
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ updateStatus }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("paused");
    expect(updateStatus).toHaveBeenCalled();
  });

  it("resumes a paused track", async () => {
    const updateStatus = vi.fn(async () => baseTrack({ status: "active" }));
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({
          byId: vi.fn(async () => baseTrack({ status: "paused", pausedAt: now })),
          updateStatus,
        }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("active");
    expect(updateStatus).toHaveBeenCalled();
  });

  it("archives an active track", async () => {
    const updateStatus = vi.fn(async () =>
      baseTrack({ status: "archived", archivedAt: now, archivedBy: adminId }),
    );
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ updateStatus }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("archived");
    expect(updateStatus).toHaveBeenCalled();
  });

  it("returns 400 on an invalid action", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/v1/tracks/:trackId/structure (saveTrackStructure)", () => {
  it("returns 200 on a free-mode envelope", async () => {
    const saveStructure = vi.fn(async () => baseTrack());
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ saveStructure }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/structure`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, data: { mode: "free" } }),
    });
    expect(res.status).toBe(200);
    expect(saveStructure).toHaveBeenCalled();
  });

  it("returns 200 on an ordered_sections envelope", async () => {
    const saveStructure = vi.fn(async () => baseTrack());
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ saveStructure }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/structure`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        v: 1,
        data: {
          mode: "ordered_sections",
          sections: [
            { id: "s_1", title: "Intro", activityIds: [] },
            { id: "s_2", title: "Practice", activityIds: ["a_1", "a_2"] },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(saveStructure).toHaveBeenCalled();
  });

  it("returns 400 on a malformed envelope (wrong v)", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/structure`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 2, data: { mode: "free" } }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the trackId param is missing/empty", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    // 65-char id exceeds the 64-char param limit → 400 from the param zValidator.
    const tooLong = "x".repeat(65);
    const res = await app.request(`/api/v1/tracks/${tooLong}/structure`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, data: { mode: "free" } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/v1/tracks/:trackId/contribution-policy (saveContributionPolicy)", () => {
  it("returns 200 on a valid envelope", async () => {
    const saveContributionPolicy = vi.fn(async () => baseTrack());
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({ saveContributionPolicy }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/contribution-policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, data: { mode: "required_review" } }),
    });
    expect(res.status).toBe(200);
    expect(saveContributionPolicy).toHaveBeenCalled();
  });

  it("returns 400 on an invalid mode", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort(),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/contribution-policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, data: { mode: "yolo" } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/g/:groupId/t/:trackId/summary (getTrackSummary)", () => {
  it("returns 200 with the M4 counts payload", async () => {
    const app = harness({
      userId: adminId,
      ports: {
        users: makeUsersPort(adminUser),
        groups: makeGroupsPort(),
        tracks: makeTracksPort({
          countFacilitators: vi.fn(async () => 2),
          countEnrollments: vi.fn(async () => 7),
        }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/t/${tid}/summary`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activityCount: number;
      sessionCount: number;
      libraryItemCount: number;
      pendingContributionCount: number;
      facilitatorCount: number;
      enrollmentCount: number;
    };
    expect(body.activityCount).toBe(0);
    expect(body.sessionCount).toBe(0);
    expect(body.libraryItemCount).toBe(0);
    expect(body.pendingContributionCount).toBe(0);
    expect(body.facilitatorCount).toBe(2);
    expect(body.enrollmentCount).toBe(7);
  });

  it("returns 404 for a non-member", async () => {
    const app = harness({
      userId: strangerId,
      ports: {
        users: makeUsersPort(strangerUser),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
        tracks: makeTracksPort({ enrollment: vi.fn(async () => null) }),
        policy: makePolicyPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/t/${tid}/summary`);
    expect(res.status).toBe(404);
  });
});
