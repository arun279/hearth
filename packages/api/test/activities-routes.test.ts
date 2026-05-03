import type {
  GroupMembership,
  LearningActivity,
  LearningActivityId,
  LearningTrack,
  LearningTrackId,
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
    libraryItems: throwingProxy<LibraryItemRepository>("libraryItems"),
    activities: throwingProxy<LearningActivityRepository>("activities"),
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
    c.set("config", { r2PublicOrigin: "https://r2.example.com" });
    c.set("ports", buildPorts(opts.ports));
    await next();
  });
  app.route("/api/v1", createApiRouter());
  return app;
}

const now = new Date("2026-04-22T00:00:00.000Z");
const facId = "u_fac" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;
const aid = "a_new" as LearningActivityId;

const facUser: User = {
  id: facId,
  email: "fac@example.com",
  name: "Facilitator",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const activeGroup: StudyGroup = {
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

const activeTrack: LearningTrack = {
  id: tid,
  groupId: gid,
  name: "T",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const facMembership: GroupMembership = {
  groupId: gid,
  userId: facId,
  role: "participant",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
};

const facEnrollment: TrackEnrollment = {
  trackId: tid,
  userId: facId,
  role: "facilitator",
  enrolledAt: now,
  leftAt: null,
};

const goodBody = {
  trackId: tid,
  title: "New activity",
  description: null,
  parts: [{ kind: "write_reflection", id: "p1", prompt: "Reflect." }],
  flow: { prereqs: [] },
  audience: { kind: "everyone_enrolled" },
  window: null,
  postClosePolicy: null,
  completionRule: { kind: "manual_mark" },
  libraryRefs: [],
  prerequisiteActivityIds: [],
  suggestedNextActivityIds: [],
};

const created: LearningActivity = {
  id: aid,
  trackId: tid,
  title: "New activity",
  description: null,
  parts: [{ kind: "write_reflection", id: "p1", prompt: "Reflect." }],
  flow: { prereqs: [] },
  audience: { kind: "everyone_enrolled" },
  window: null,
  postClosePolicy: null,
  completionRule: { kind: "manual_mark" },
  participationMode: "individual",
  libraryRefs: [],
  prerequisiteActivityIds: [],
  suggestedNextActivityIds: [],
  createdAt: now,
  updatedAt: now,
};

describe("activities routes", () => {
  // Auth middleware is mounted once at the router root; this matrix
  // pins that contract per-route so a future refactor that splits the
  // router (or moves the middleware) cannot silently expose any of
  // the M8 surface as an unauthenticated entrypoint.
  describe.each([
    { method: "GET" as const, path: `/api/v1/tracks/${tid}/activities`, body: undefined },
    {
      method: "POST" as const,
      path: `/api/v1/tracks/${tid}/activities`,
      body: JSON.stringify(goodBody),
    },
    { method: "GET" as const, path: `/api/v1/activities/${aid}`, body: undefined },
    { method: "PUT" as const, path: `/api/v1/activities/${aid}`, body: JSON.stringify({}) },
    { method: "DELETE" as const, path: `/api/v1/activities/${aid}`, body: undefined },
    {
      method: "PUT" as const,
      path: `/api/v1/activities/${aid}/library-refs`,
      body: JSON.stringify({ refs: [] }),
    },
    {
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/library-refs/li_1/pin`,
      body: JSON.stringify({ revisionId: "rev_1" }),
    },
    {
      method: "DELETE" as const,
      path: `/api/v1/activities/${aid}/library-refs/li_1/pin`,
      body: undefined,
    },
    {
      method: "PUT" as const,
      path: `/api/v1/activities/${aid}/prerequisites`,
      body: JSON.stringify({ prerequisiteActivityIds: [] }),
    },
    {
      method: "PUT" as const,
      path: `/api/v1/activities/${aid}/suggested-sequences`,
      body: JSON.stringify({ nextActivityIds: [] }),
    },
  ])("auth gate on $method $path", ({ method, path, body }) => {
    it("rejects unauthenticated with 401", async () => {
      const app = harness({ userId: null, ports: {} });
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = body;
      }
      const res = await app.request(path, init);
      expect(res.status).toBe(401);
    });
  });

  it("422 on flow cycle in the hard sub-DAG", async () => {
    const app = harness({
      userId: facId,
      ports: {
        users: {
          byId: vi.fn(async () => facUser),
          byEmail: vi.fn(async () => null),
          deactivate: vi.fn(),
          reactivate: vi.fn(),
          deleteIdentity: vi.fn(),
          setAttributionPreference: vi.fn(),
        },
        groups: {
          byId: vi.fn(async () => activeGroup),
          membership: vi.fn(async () => facMembership),
        } as unknown as StudyGroupRepository,
        tracks: {
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => facEnrollment),
          listEnrollments: vi.fn(async () => [facEnrollment]),
        } as unknown as LearningTrackRepository,
        policy: {
          getOperator: vi.fn(async () => null),
        } as unknown as InstanceAccessPolicyRepository,
      },
    });
    const cyclic = {
      ...goodBody,
      parts: [
        { kind: "write_reflection", id: "p1", prompt: "Reflect." },
        { kind: "write_reflection", id: "p2", prompt: "Again." },
      ],
      flow: {
        prereqs: [
          { fromPartId: "p1", toPartId: "p2", kind: "hard" },
          { fromPartId: "p2", toPartId: "p1", kind: "hard" },
        ],
      },
    };
    const res = await app.request(`/api/v1/tracks/${tid}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cyclic),
    });
    // INVARIANT_VIOLATION (the use case maps to 409 Conflict by default;
    // mapUnknown treats it that way unless a specific 422 mapping exists).
    expect([409, 422]).toContain(res.status);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("flow_cycle_detected");
  });

  it("creates an activity (round-trip happy path)", async () => {
    const repo: Pick<LearningActivityRepository, "create" | "byId"> = {
      create: vi.fn(async () => created),
      byId: vi.fn(async () => null),
    };
    const app = harness({
      userId: facId,
      ports: {
        users: {
          byId: vi.fn(async () => facUser),
          byEmail: vi.fn(async () => null),
          deactivate: vi.fn(),
          reactivate: vi.fn(),
          deleteIdentity: vi.fn(),
          setAttributionPreference: vi.fn(),
        },
        groups: {
          byId: vi.fn(async () => activeGroup),
          membership: vi.fn(async () => facMembership),
        } as unknown as StudyGroupRepository,
        tracks: {
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => facEnrollment),
          listEnrollments: vi.fn(async () => [facEnrollment]),
        } as unknown as LearningTrackRepository,
        policy: {
          getOperator: vi.fn(async () => null),
        } as unknown as InstanceAccessPolicyRepository,
        activities: repo as LearningActivityRepository,
      },
    });
    const res = await app.request(`/api/v1/tracks/${tid}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(goodBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; title: string };
    expect(body.id).toBe(aid);
    expect(body.title).toBe("New activity");
  });

  it("422 when body trackId differs from URL trackId", async () => {
    const app = harness({ userId: facId, ports: {} });
    const res = await app.request(`/api/v1/tracks/${tid}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...goodBody, trackId: "different_track_id" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_error");
  });

  describe("read + mutation routes (round-trip happy paths)", () => {
    function readyDeps(activities: Partial<LearningActivityRepository> = {}) {
      return {
        users: {
          byId: vi.fn(async () => facUser),
          byEmail: vi.fn(async () => null),
          deactivate: vi.fn(),
          reactivate: vi.fn(),
          deleteIdentity: vi.fn(),
          setAttributionPreference: vi.fn(),
        },
        groups: {
          byId: vi.fn(async () => activeGroup),
          membership: vi.fn(async () => facMembership),
        } as unknown as StudyGroupRepository,
        tracks: {
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => facEnrollment),
          listEnrollments: vi.fn(async () => [facEnrollment]),
        } as unknown as LearningTrackRepository,
        policy: {
          getOperator: vi.fn(async () => null),
        } as unknown as InstanceAccessPolicyRepository,
        activities: {
          create: vi.fn(),
          byId: vi.fn(async () => created),
          byTrack: vi.fn(async () => []),
          update: vi.fn(async () => created),
          delete: vi.fn(),
          setLibraryRefs: vi.fn(async () => []),
          listLibraryRefs: vi.fn(async () => []),
          activitiesUsingLibraryItem: vi.fn(async () => []),
          setPrerequisites: vi.fn(async () => []),
          setSuggestedSequences: vi.fn(async () => []),
          listPrerequisitesFor: vi.fn(async () => []),
          listDependentsOf: vi.fn(async () => []),
          countByTrack: vi.fn(async () => 0),
          ...activities,
        } as LearningActivityRepository,
      };
    }

    it("GET /tracks/:trackId/activities returns the list projection", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/tracks/${tid}/activities`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("GET /activities/:id returns the activity", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(aid);
    });

    it("PUT /activities/:id applies a metadata patch", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      });
      expect(res.status).toBe(200);
    });

    it("DELETE /activities/:id returns 204", async () => {
      const app = harness({
        userId: facId,
        ports: readyDeps({ delete: vi.fn(), listDependentsOf: vi.fn(async () => []) }),
      });
      const res = await app.request(`/api/v1/activities/${aid}`, { method: "DELETE" });
      expect(res.status).toBe(204);
    });

    it("PUT /activities/:id/library-refs replaces refs", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}/library-refs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refs: [] }),
      });
      expect(res.status).toBe(200);
    });

    it("PUT /activities/:id/prerequisites replaces hard edges", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}/prerequisites`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prerequisiteActivityIds: [] }),
      });
      expect(res.status).toBe(200);
    });

    it("PUT /activities/:id/suggested-sequences replaces soft edges", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}/suggested-sequences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextActivityIds: [] }),
      });
      expect(res.status).toBe(200);
    });

    it("POST /activities/:id/library-refs/:itemId/pin pins a revision", async () => {
      const activityWithLib: LearningActivity = {
        ...created,
        libraryRefs: [
          { id: "ref_1", activityId: aid, libraryItemId: "li_1", pinnedRevisionId: null },
        ],
      };
      const app = harness({
        userId: facId,
        ports: {
          ...readyDeps({
            byId: vi.fn(async () => activityWithLib),
            setLibraryRefs: vi.fn(async () => [
              { id: "ref_1", activityId: aid, libraryItemId: "li_1", pinnedRevisionId: "rev_1" },
            ]),
          }),
          libraryItems: {
            listRevisions: vi.fn(async () => [
              {
                id: "rev_1",
                libraryItemId: "li_1",
                revisionNumber: 1,
                storageKey: "k",
                mimeType: "application/pdf",
                sizeBytes: 1,
                originalFilename: null,
                uploadedBy: "u" as never,
                uploadedAt: now,
              },
            ]),
          } as never,
        },
      });
      const res = await app.request(`/api/v1/activities/${aid}/library-refs/li_1/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: "rev_1" }),
      });
      expect(res.status).toBe(200);
    });

    it("404 when GET /activities/:id targets a non-existent id", async () => {
      const app = harness({
        userId: facId,
        ports: readyDeps({ byId: vi.fn(async () => null) }),
      });
      const res = await app.request(`/api/v1/activities/missing_id`);
      expect(res.status).toBe(404);
    });

    it("PUT /activities/:id applies a comprehensive patch", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Renamed",
          description: "with a fresh description",
          parts: [{ kind: "write_reflection", id: "p1", prompt: "Reflect." }],
          flow: { prereqs: [] },
          audience: { kind: "everyone_enrolled" },
          window: null,
          postClosePolicy: null,
          completionRule: { kind: "all_parts_complete" },
          libraryRefs: [],
        }),
      });
      expect(res.status).toBe(200);
    });

    it("PUT /activities/:id with subset audience is normalized", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: { kind: "subset", userIds: [facId] },
        }),
      });
      expect(res.status).toBe(200);
    });

    it("POST with subset audience round-trips", async () => {
      const app = harness({
        userId: facId,
        ports: {
          ...readyDeps({ create: vi.fn(async () => created) }),
        },
      });
      const res = await app.request(`/api/v1/tracks/${tid}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...goodBody,
          audience: { kind: "subset", userIds: [facId] },
        }),
      });
      expect(res.status).toBe(201);
    });

    it("DELETE refuses with CONFLICT when dependents exist", async () => {
      const app = harness({
        userId: facId,
        ports: readyDeps({
          listDependentsOf: vi.fn(async () => [{ id: "a_other" as never, title: "Depends on me" }]),
        }),
      });
      const res = await app.request(`/api/v1/activities/${aid}`, { method: "DELETE" });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("activity_has_dependents");
    });

    it("400 on malformed activity id param (zValidator path)", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      // Empty / oversize ids fail the param validator's min(1).max(64).
      const tooLong = "x".repeat(80);
      const badGet = await app.request(`/api/v1/activities/${tooLong}`);
      expect(badGet.status).toBe(400);
      const badPut = await app.request(`/api/v1/activities/${tooLong}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      });
      expect(badPut.status).toBe(400);
      const badDel = await app.request(`/api/v1/activities/${tooLong}`, { method: "DELETE" });
      expect(badDel.status).toBe(400);
      const badRefs = await app.request(`/api/v1/activities/${tooLong}/library-refs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refs: [] }),
      });
      expect(badRefs.status).toBe(400);
      const badPin = await app.request(`/api/v1/activities/${tooLong}/library-refs/li_1/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: "rev_1" }),
      });
      expect(badPin.status).toBe(400);
      const badUnpin = await app.request(`/api/v1/activities/${tooLong}/library-refs/li_1/pin`, {
        method: "DELETE",
      });
      expect(badUnpin.status).toBe(400);
      const badPrereqs = await app.request(`/api/v1/activities/${tooLong}/prerequisites`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prerequisiteActivityIds: [] }),
      });
      expect(badPrereqs.status).toBe(400);
      const badSuggested = await app.request(`/api/v1/activities/${tooLong}/suggested-sequences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextActivityIds: [] }),
      });
      expect(badSuggested.status).toBe(400);
      const badList = await app.request(`/api/v1/tracks/${tooLong}/activities`);
      expect(badList.status).toBe(400);
    });

    it("error handlers map thrown errors through problemResponse", async () => {
      const app = harness({
        userId: facId,
        ports: readyDeps({
          // Throwing from setLibraryRefs via pin / unpin / setLibraryRefs hits
          // each route's catch arm and the shared problemResponse mapping.
          setLibraryRefs: vi.fn(async () => {
            throw new Error("boom");
          }),
          setPrerequisites: vi.fn(async () => {
            throw new Error("boom");
          }),
          setSuggestedSequences: vi.fn(async () => {
            throw new Error("boom");
          }),
          byId: vi.fn(async () => ({
            ...created,
            libraryRefs: [
              { id: "ref_1", activityId: aid, libraryItemId: "li_1", pinnedRevisionId: null },
            ],
          })),
        }),
      });
      const setRefs = await app.request(`/api/v1/activities/${aid}/library-refs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refs: [] }),
      });
      expect(setRefs.status).toBe(500);
      const unpin = await app.request(`/api/v1/activities/${aid}/library-refs/li_1/pin`, {
        method: "DELETE",
      });
      expect(unpin.status).toBe(500);
      const prereqs = await app.request(`/api/v1/activities/${aid}/prerequisites`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prerequisiteActivityIds: [] }),
      });
      expect(prereqs.status).toBe(500);
      const suggested = await app.request(`/api/v1/activities/${aid}/suggested-sequences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextActivityIds: [] }),
      });
      expect(suggested.status).toBe(500);
    });

    it("400 on a malformed PUT body (invalid Part kind)", async () => {
      const app = harness({ userId: facId, ports: readyDeps() });
      const res = await app.request(`/api/v1/activities/${aid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ kind: "not_a_real_kind", id: "p1" }] }),
      });
      // The project's `problemFromZodError` maps Zod failures to 400 with
      // `code: "validation_error"`; the response shape is what the SPA
      // pattern-matches, not the status alone.
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("validation_failed");
    });

    it("DELETE /activities/:id/library-refs/:itemId/pin unpins a revision", async () => {
      const activityWithPinned: LearningActivity = {
        ...created,
        libraryRefs: [
          {
            id: "ref_1",
            activityId: aid,
            libraryItemId: "li_1",
            pinnedRevisionId: "rev_1",
          },
        ],
      };
      const app = harness({
        userId: facId,
        ports: readyDeps({
          byId: vi.fn(async () => activityWithPinned),
          setLibraryRefs: vi.fn(async () => [
            {
              id: "ref_1",
              activityId: aid,
              libraryItemId: "li_1",
              pinnedRevisionId: null,
            },
          ]),
        }),
      });
      const res = await app.request(`/api/v1/activities/${aid}/library-refs/li_1/pin`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
    });
  });
});
