import type {
  ActivityRecord,
  ActivityRecordId,
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
  ActivityRecordRepository,
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
    records: throwingProxy<ActivityRecordRepository>("records"),
    sessions: throwingProxy<Ports["sessions"]>("sessions"),
    storage: throwingProxy<ObjectStorage>("storage"),
    uploads: throwingProxy<UploadCoordinationRepository>("uploads"),
    flags: throwingProxy<SystemFlagRepository>("flags"),
    clock: { now: () => now },
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

const now = new Date("2026-05-29T00:00:00.000Z");
const actorId = "u_actor" as UserId;
const otherId = "u_other" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;
const aid = "a_1" as LearningActivityId;
const rid = "ar_1" as ActivityRecordId;

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
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

function membershipOf(role: "admin" | "participant"): GroupMembership {
  return {
    groupId: gid,
    userId: actorId,
    role,
    joinedAt: now,
    removedAt: null,
    removedBy: null,
    attributionOnLeave: null,
    displayNameSnapshot: null,
    profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
  };
}

function enrollmentOf(role: "facilitator" | "participant"): TrackEnrollment {
  return { trackId: tid, userId: actorId, role, enrolledAt: now, leftAt: null };
}

function activity(overrides: Partial<LearningActivity> = {}): LearningActivity {
  return {
    id: aid,
    trackId: tid,
    title: "A",
    description: null,
    parts: [
      { kind: "write_reflection", id: "p_reflect", prompt: "Reflect." },
      {
        kind: "quiz",
        id: "p_quiz",
        questions: [
          {
            id: "q1",
            prompt: "Pick",
            shape: { kind: "multiple_choice", options: ["A", "B"], answerKeyIndex: 1 },
          },
        ],
      },
    ],
    flow: { prereqs: [], displayOrder: ["p_reflect", "p_quiz"] },
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
    ...overrides,
  };
}

function record(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: rid,
    activityId: aid,
    participantId: actorId,
    completionState: "in_progress",
    completedAt: null,
    visibilityOverride: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Context ports for a viewer of the activity, at the given track role. */
function viewerPorts(opts: {
  role?: "facilitator" | "participant";
  adminMembership?: boolean;
  act?: LearningActivity;
}): Partial<Ports> {
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
      membership: vi.fn(async () => membershipOf(opts.adminMembership ? "admin" : "participant")),
    } as unknown as StudyGroupRepository,
    tracks: {
      byId: vi.fn(async () => track),
      enrollment: vi.fn(async () => enrollmentOf(opts.role ?? "participant")),
    } as unknown as LearningTrackRepository,
    policy: {
      getOperator: vi.fn(async () => null),
    } as unknown as InstanceAccessPolicyRepository,
    activities: {
      byId: vi.fn(async () => opts.act ?? activity()),
    } as unknown as LearningActivityRepository,
  };
}

function recordsPort(overrides: Partial<ActivityRecordRepository>): ActivityRecordRepository {
  return {
    upsert: vi.fn(async () => record()),
    byId: vi.fn(async () => record()),
    byParticipantAndActivity: vi.fn(async () => record()),
    listByActivity: vi.fn(async () => []),
    setCompletion: vi.fn(async () => record({ completionState: "completed", completedAt: now })),
    setVisibilityOverride: vi.fn(async () => record({ visibilityOverride: "private" })),
    getPartProgress: vi.fn(async () => null),
    listPartProgress: vi.fn(async () => []),
    savePartProgress: vi.fn(async () => ({
      id: "pp_1",
      activityRecordId: rid,
      partId: "p_reflect" as never,
      state: { kind: "write_reflection", completed: true, text: "x" } as const,
      updatedAt: now,
    })),
    listPartHistory: vi.fn(async () => []),
    countPartHistory: vi.fn(async () => 0),
    reopenAgainstRevision: vi.fn(async () => {}),
    ...overrides,
  } as ActivityRecordRepository;
}

describe("records routes", () => {
  describe.each([
    { method: "GET" as const, path: `/api/v1/activities/${aid}/my-record`, body: undefined },
    {
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/parts/p_reflect`,
      body: JSON.stringify({ state: { kind: "write_reflection", completed: true, text: "x" } }),
    },
    {
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`,
      body: JSON.stringify({ answers: [] }),
    },
    {
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/complete`,
      body: undefined,
    },
    {
      method: "PATCH" as const,
      path: `/api/v1/records/${rid}/visibility-override`,
      body: JSON.stringify({ override: null }),
    },
    { method: "GET" as const, path: `/api/v1/records/${rid}`, body: undefined },
    { method: "GET" as const, path: `/api/v1/records/${rid}/history`, body: undefined },
    {
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/participants/${otherId}/reset`,
      body: undefined,
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

  describe.each([
    {
      label: "GET /my-record",
      method: "GET" as const,
      path: `/api/v1/activities/${aid}/my-record`,
      body: undefined,
    },
    {
      label: "POST /my-record/parts/:partId",
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/parts/p_reflect`,
      body: JSON.stringify({ state: { kind: "write_reflection", completed: true, text: "x" } }),
    },
    {
      label: "POST /my-record/parts/:partId/quiz",
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`,
      body: JSON.stringify({ answers: [] }),
    },
    {
      label: "POST /my-record/complete",
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/complete`,
      body: undefined,
    },
  ])("$label surfaces a thrown use-case error as a problem response", ({ method, path, body }) => {
    it("returns 404 when the activity isn't viewable", async () => {
      const app = harness({
        userId: actorId,
        ports: {
          ...viewerPorts({}),
          activities: { byId: vi.fn(async () => null) } as unknown as LearningActivityRepository,
          records: recordsPort({}),
        },
      });
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = body;
      }
      const res = await app.request(path, init);
      expect(res.status).toBe(404);
    });
  });

  describe.each([
    {
      label: "POST /my-record/parts/:partId",
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/parts/p_reflect`,
      body: JSON.stringify({ state: { kind: "not_a_part_kind" } }),
    },
    {
      label: "POST /my-record/parts/:partId/quiz",
      method: "POST" as const,
      path: `/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`,
      body: JSON.stringify({ answers: "not-an-array" }),
    },
    {
      label: "PATCH /records/:recordId/visibility-override",
      method: "PATCH" as const,
      path: `/api/v1/records/${rid}/visibility-override`,
      body: JSON.stringify({ override: "not_a_preference" }),
    },
  ])("$label rejects a malformed body", ({ method, path, body }) => {
    it("returns a 400 problem from the validator", async () => {
      const app = harness({
        userId: actorId,
        ports: { ...viewerPorts({}), records: recordsPort({}) },
      });
      const res = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(res.status).toBe(400);
    });
  });

  it("GET /my-record returns the resume view", async () => {
    const app = harness({
      userId: actorId,
      ports: { ...viewerPorts({}), records: recordsPort({}) },
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      record: { id: string };
      partProgress: unknown[];
      partsWithHistory: string[];
      partHistoryCount: number;
    };
    expect(body.record.id).toBe(rid);
    expect(body.partProgress).toEqual([]);
    expect(body.partsWithHistory).toEqual([]);
    expect(body.partHistoryCount).toBe(0);
  });

  it("POST /my-record/parts/:partId saves progress and echoes the record", async () => {
    const app = harness({
      userId: actorId,
      ports: { ...viewerPorts({}), records: recordsPort({}) },
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_reflect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: { kind: "write_reflection", completed: true, text: "hi" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partProgress: { partId: string }; record: { id: string } };
    expect(body.partProgress.partId).toBe("p_reflect");
    expect(body.record.id).toBe(rid);
  });

  it("POST /my-record/parts/:partId/quiz grades and returns part progress", async () => {
    let savedQuiz: { kind: string; answers: ReadonlyArray<{ result: string }> } | undefined;
    const records = recordsPort({
      savePartProgress: vi.fn(async (input) => {
        savedQuiz = input.state as never;
        return {
          id: "pp_q",
          activityRecordId: rid,
          partId: "p_quiz" as never,
          state: input.state,
          updatedAt: now,
        };
      }),
    });
    const app = harness({ userId: actorId, ports: { ...viewerPorts({}), records } });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: [{ questionId: "q1", response: { kind: "multiple_choice", selectedIndex: 1 } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partProgress: { partId: string } };
    expect(body.partProgress.partId).toBe("p_quiz");
    expect(savedQuiz?.answers[0]?.result).toBe("correct");
  });

  it("POST /my-record/complete completes the record", async () => {
    const app = harness({
      userId: actorId,
      ports: { ...viewerPorts({}), records: recordsPort({}) },
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completionState: string };
    expect(body.completionState).toBe("completed");
  });

  it("PATCH /records/:id/visibility-override sets the override for the owner", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: {
          byId: vi.fn(async () => actor),
          byEmail: vi.fn(async () => null),
          deactivate: vi.fn(),
          reactivate: vi.fn(),
          deleteIdentity: vi.fn(),
          setAttributionPreference: vi.fn(),
        },
        records: recordsPort({}),
      },
    });
    const res = await app.request(`/api/v1/records/${rid}/visibility-override`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override: "private" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visibilityOverride: string };
    expect(body.visibilityOverride).toBe("private");
  });

  it("PATCH /records/:id/visibility-override is 403 for a non-owner", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: {
          byId: vi.fn(async () => actor),
          byEmail: vi.fn(async () => null),
          deactivate: vi.fn(),
          reactivate: vi.fn(),
          deleteIdentity: vi.fn(),
          setAttributionPreference: vi.fn(),
        },
        records: recordsPort({ byId: vi.fn(async () => record({ participantId: otherId })) }),
      },
    });
    const res = await app.request(`/api/v1/records/${rid}/visibility-override`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override: "private" }),
    });
    expect(res.status).toBe(403);
  });

  it("GET /records/:id returns full detail for the owner", async () => {
    const app = harness({
      userId: actorId,
      ports: { ...viewerPorts({}), records: recordsPort({}) },
    });
    const res = await app.request(`/api/v1/records/${rid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scope: string; record: { id: string } };
    expect(body.scope).toBe("full");
    expect(body.record.id).toBe(rid);
  });

  it("GET /records/:id is 404 (hides existence) for a non-authority viewing another's record", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        ...viewerPorts({ role: "participant" }),
        records: recordsPort({ byId: vi.fn(async () => record({ participantId: otherId })) }),
      },
    });
    const res = await app.request(`/api/v1/records/${rid}`);
    expect(res.status).toBe(404);
  });

  it("GET /records/:id/history returns history for an authorized viewer", async () => {
    const history = [
      {
        id: "h1",
        activityRecordId: rid,
        partId: "p_reflect" as never,
        snapshot: { kind: "write_reflection", completed: false, text: "" } as const,
        reason: "retry" as const,
        revisionIdAtTime: null,
        recordedAt: now,
      },
    ];
    const app = harness({
      userId: actorId,
      ports: {
        ...viewerPorts({}),
        records: recordsPort({ listPartHistory: vi.fn(async () => history) }),
      },
    });
    const res = await app.request(`/api/v1/records/${rid}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { history: unknown[] };
    expect(body.history).toHaveLength(1);
  });

  it("GET /records/:id/history is 404 for a non-authority (no leak)", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        ...viewerPorts({ role: "participant" }),
        records: recordsPort({ byId: vi.fn(async () => record({ participantId: otherId })) }),
      },
    });
    const res = await app.request(`/api/v1/records/${rid}/history`);
    expect(res.status).toBe(404);
  });

  it("POST /participants/:id/reset succeeds for a facilitator", async () => {
    const reopenAgainstRevision = vi.fn(async () => {});
    const target = record({ id: "ar_target" as ActivityRecordId, participantId: otherId });
    const app = harness({
      userId: actorId,
      ports: {
        ...viewerPorts({ role: "facilitator" }),
        records: recordsPort({
          byParticipantAndActivity: vi.fn(async () => target),
          byId: vi.fn(async () => target),
          reopenAgainstRevision,
        }),
      },
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants/${otherId}/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(reopenAgainstRevision).toHaveBeenCalled();
  });

  it("POST /participants/:id/reset is 403 for a non-authority participant", async () => {
    const app = harness({
      userId: actorId,
      ports: { ...viewerPorts({ role: "participant" }), records: recordsPort({}) },
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants/${otherId}/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("400 on a malformed part-progress body", async () => {
    const app = harness({
      userId: actorId,
      ports: { ...viewerPorts({}), records: recordsPort({}) },
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_reflect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: { kind: "not_a_kind", completed: true } }),
    });
    expect(res.status).toBe(400);
  });
});
