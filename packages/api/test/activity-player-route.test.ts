import type {
  GroupMembership,
  LearningActivity,
  LearningActivityId,
  LearningTrack,
  LearningTrackId,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
  StudyGroup,
  StudyGroupId,
  TrackEnrollment,
  User,
  UserId,
} from "@hearth/domain";
import type {
  IdGenerator,
  InstanceAccessPolicyRepository,
  KillswitchGate,
  KillswitchMode,
  LearningActivityRepository,
  LearningTrackRepository,
  LibraryItemRepository,
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
import { killswitchMiddleware } from "../src/middleware/killswitch.ts";

type Ports = AppBindings["Variables"]["ports"];

/**
 * Sentinel proxy for ports the player route should never touch. A method
 * call against an unset port throws instead of returning `undefined`, so
 * a future regression that fans the route into an unrelated repository
 * fails loudly here instead of silently returning a malformed payload.
 */
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
    libraryItems: throwingProxy<LibraryItemRepository>("libraryItems"),
    activities: throwingProxy<LearningActivityRepository>("activities"),
    records: throwingProxy<Ports["records"]>("records"),
    sessions: throwingProxy<Ports["sessions"]>("sessions"),
    storage: throwingProxy<ObjectStorage>("storage"),
    uploads: throwingProxy<UploadCoordinationRepository>("uploads"),
    flags: throwingProxy<SystemFlagRepository>("flags"),
    clock: { now: () => new Date("2026-05-18T00:00:00.000Z") },
    ids: { generate: () => "id_test" } as IdGenerator,
    ...overrides,
  };
}

type HarnessOpts = {
  readonly userId: string | null;
  readonly ports: Partial<Ports>;
  readonly killswitchMode?: KillswitchMode;
  readonly now?: Date;
};

function harness(opts: HarnessOpts) {
  const mode: KillswitchMode = opts.killswitchMode ?? "normal";
  const gate: KillswitchGate = {
    getMode: async () => mode,
    assertWritable: async () => {
      if (mode !== "normal") throw new Error(`killswitch: ${mode}`);
    },
    invalidate: () => {},
  };
  const app = new Hono<AppBindings>();
  const overrides: Partial<Ports> = opts.now
    ? { ...opts.ports, clock: { now: () => opts.now as Date } }
    : opts.ports;
  app.use("*", async (c, next) => {
    c.set("userId", opts.userId);
    c.set("auth", { handler: async () => new Response(null) });
    c.set("gate", gate);
    c.set("adminToken", "a".repeat(64));
    c.set("writeLimiter", { limit: async () => ({ success: true }) });
    c.set("authLimiter", { limit: async () => ({ success: true }) });
    c.set("config", { r2PublicOrigin: "https://r2.example.com" });
    c.set("ports", buildPorts(overrides));
    await next();
  });
  app.use("*", killswitchMiddleware());
  app.route("/api/v1", createApiRouter());
  return app;
}

const now = new Date("2026-05-18T00:00:00.000Z");
const actorId = "u_actor" as UserId;
const otherId = "u_other" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;
const aid = "a_1" as LearningActivityId;
const itemId = "li_1" as LibraryItemId;
const revId = "lr_1" as LibraryRevisionId;

const actor: User = {
  id: actorId,
  email: "u@x.com",
  name: "Actor",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
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

const track: LearningTrack = {
  id: tid,
  groupId: gid,
  name: "T",
  description: null,
  status: "active",
  peerProgressVisibility: "shared",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const participantMembership: GroupMembership = {
  groupId: gid,
  userId: actorId,
  role: "participant",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
};

const participantEnrollment: TrackEnrollment = {
  trackId: tid,
  userId: actorId,
  role: "participant",
  enrolledAt: now,
  leftAt: null,
};

function makeActivity(overrides: Partial<LearningActivity> = {}): LearningActivity {
  return {
    id: aid,
    trackId: tid,
    title: "A",
    description: null,
    parts: [
      {
        kind: "read_library_item",
        id: "p_read",
        libraryItemId: itemId,
        title: "Chapter 1",
      },
    ],
    flow: { prereqs: [], displayOrder: ["p_read"] },
    audience: { kind: "everyone_enrolled" },
    window: null,
    postClosePolicy: null,
    completionRule: { kind: "manual_mark" },
    participationMode: "individual",
    libraryRefs: [{ id: "alr_1", activityId: aid, libraryItemId: itemId, pinnedRevisionId: null }],
    prerequisiteActivityIds: [],
    suggestedNextActivityIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const revision: LibraryRevision = {
  id: revId,
  libraryItemId: itemId,
  revisionNumber: 1,
  storageKey: `library/${gid}/${itemId}/${revId}`,
  mimeType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: "primer.pdf",
  uploadedBy: actorId,
  uploadedAt: now,
};

function happyPorts(opts: { activity: LearningActivity; nowDate?: Date }): Partial<Ports> {
  return {
    users: {
      byId: vi.fn(async () => actor),
      byEmail: vi.fn(async () => null),
      deactivate: vi.fn(),
      reactivate: vi.fn(),
      deleteIdentity: vi.fn(),
      setAttributionPreference: vi.fn(),
    },
    groups: {
      byId: vi.fn(async () => group),
      membership: vi.fn(async () => participantMembership),
    } as unknown as StudyGroupRepository,
    tracks: {
      byId: vi.fn(async () => track),
      enrollment: vi.fn(async () => participantEnrollment),
    } as unknown as LearningTrackRepository,
    policy: {
      getOperator: vi.fn(async () => null),
    } as unknown as InstanceAccessPolicyRepository,
    activities: {
      byId: vi.fn(async () => opts.activity),
    } as unknown as LearningActivityRepository,
    libraryItems: {
      currentRevision: vi.fn(async () => revision),
      revisionById: vi.fn(async () => revision),
    } as unknown as LibraryItemRepository,
    storage: {
      getDownloadUrl: vi.fn(
        async ({ key, ttlSeconds }) => `https://r2.example.com/${key}?signed&ttl=${ttlSeconds}`,
      ),
    } as unknown as ObjectStorage,
    clock: { now: () => opts.nowDate ?? now },
  };
}

describe("GET /api/v1/activities/:id/player", () => {
  it("returns the player projection on the happy path (member + everyone_enrolled audience)", async () => {
    const activity = makeActivity();
    const app = harness({ userId: actorId, ports: happyPorts({ activity }) });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activity: { id: string; title: string };
      resolvedRefs: ReadonlyArray<{
        partId: string;
        readUrl: string;
        revisionId: string;
        isPinned: boolean;
        mimeType: string;
      }>;
      accessState: string;
      viewer: { enrollmentStatus: string };
    };
    expect(body.activity.id).toBe(aid);
    expect(body.activity.title).toBe("A");
    expect(body.accessState).toBe("open");
    expect(body.viewer.enrollmentStatus).toBe("participant");
    expect(body.resolvedRefs).toHaveLength(1);
    const ref = body.resolvedRefs[0];
    expect(ref?.partId).toBe("p_read");
    expect(ref?.mimeType).toBe("application/pdf");
    expect(ref?.readUrl).toContain("ttl=3600");
  });

  it("404 (not 403) when the member is excluded from a subset audience — no existence leak", async () => {
    const activity = makeActivity({
      audience: { kind: "subset", userIds: [otherId] },
    });
    const app = harness({ userId: actorId, ports: happyPorts({ activity }) });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  it("404 when the post-close policy is 'hidden' and the close instant has passed", async () => {
    const closesAt = new Date("2026-05-01T00:00:00.000Z").getTime();
    const after = new Date("2026-05-02T00:00:00.000Z");
    const activity = makeActivity({
      window: { opensAt: null, dueAt: null, closesAt },
      postClosePolicy: { kind: "hidden" },
    });
    const app = harness({
      userId: actorId,
      ports: happyPorts({ activity, nowDate: after }),
      now: after,
    });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  it("returns accessState='locked' (200) for a 'visible_locked' policy past close", async () => {
    const closesAt = new Date("2026-05-01T00:00:00.000Z").getTime();
    const after = new Date("2026-05-02T00:00:00.000Z");
    const activity = makeActivity({
      window: { opensAt: null, dueAt: null, closesAt },
      postClosePolicy: { kind: "visible_locked" },
    });
    const app = harness({
      userId: actorId,
      ports: happyPorts({ activity, nowDate: after }),
      now: after,
    });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessState: string };
    expect(body.accessState).toBe("locked");
  });

  it("returns accessState='pre_open' (200) before opensAt; no library URLs minted yet", async () => {
    const opensAt = new Date("2026-06-01T00:00:00.000Z").getTime();
    const before = new Date("2026-05-15T00:00:00.000Z");
    const activity = makeActivity({
      window: { opensAt, dueAt: null, closesAt: null },
      postClosePolicy: null,
    });
    const ports = happyPorts({ activity, nowDate: before });
    const app = harness({ userId: actorId, ports, now: before });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accessState: string;
      resolvedRefs: readonly unknown[];
    };
    expect(body.accessState).toBe("pre_open");
    expect(body.resolvedRefs).toHaveLength(0);
    expect(ports.storage?.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("404 when the activity id is unknown", async () => {
    const ports: Partial<Ports> = {
      users: {
        byId: vi.fn(async () => actor),
        byEmail: vi.fn(async () => null),
        deactivate: vi.fn(),
        reactivate: vi.fn(),
        deleteIdentity: vi.fn(),
        setAttributionPreference: vi.fn(),
      },
      activities: {
        byId: vi.fn(async () => null),
      } as unknown as LearningActivityRepository,
    };
    const app = harness({ userId: actorId, ports });
    const res = await app.request(`/api/v1/activities/missing/player`);
    expect(res.status).toBe(404);
  });

  it("401 when unauthenticated", async () => {
    const app = harness({ userId: null, ports: {} });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(401);
  });

  it("read_only killswitch permits the read (reads keep working)", async () => {
    const activity = makeActivity();
    const app = harness({
      userId: actorId,
      ports: happyPorts({ activity }),
      killswitchMode: "read_only",
    });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(200);
  });

  it("disabled killswitch blocks the route with 503 problem+json", async () => {
    const activity = makeActivity();
    const app = harness({
      userId: actorId,
      ports: happyPorts({ activity }),
      killswitchMode: "disabled",
    });
    const res = await app.request(`/api/v1/activities/${aid}/player`);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("disabled");
  });
});
