import type {
  ActivityRecord,
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
  KillswitchMode,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
  Write,
} from "@hearth/ports";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/bindings.ts";
import { createApiRouter } from "../src/index.ts";
import { killswitchMiddleware } from "../src/middleware/killswitch.ts";

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
    activities: throwingProxy<LearningActivityRepository>("activities"),
    records: throwingProxy<ActivityRecordRepository>("records"),
    sessions: throwingProxy<Ports["sessions"]>("sessions"),
    storage: throwingProxy<Ports["storage"]>("storage"),
    uploads: throwingProxy<Ports["uploads"]>("uploads"),
    flags: throwingProxy<Ports["flags"]>("flags"),
    clock: { now: () => new Date("2026-05-18T00:00:00.000Z") },
    ids: { generate: () => "id_test" } as IdGenerator,
    ...overrides,
  };
}

type HarnessOpts = {
  readonly userId: string | null;
  readonly ports: Partial<Ports>;
  readonly killswitchMode?: KillswitchMode;
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

const membership: GroupMembership = {
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

const enrollment: TrackEnrollment = {
  trackId: tid,
  userId: actorId,
  role: "participant",
  enrolledAt: now,
  leftAt: null,
};

const record: ActivityRecord = {
  id: "ar_1" as never,
  activityId: aid,
  participantId: actorId,
  completionState: "in_progress",
  completedAt: null,
  visibilityOverride: null,
  createdAt: now,
  updatedAt: now,
};

function makeActivity(overrides: Partial<LearningActivity> = {}): LearningActivity {
  return {
    id: aid,
    trackId: tid,
    title: "A",
    description: null,
    parts: [
      { kind: "write_reflection", id: "p_reflect", prompt: "Why?" },
      {
        kind: "quiz",
        id: "p_quiz",
        questions: [
          {
            id: "q1",
            prompt: "Pick",
            shape: { kind: "multiple_choice", options: ["a", "b"], answerKeyIndex: 1 },
          },
        ],
      },
    ],
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
    ...overrides,
  };
}

type RecordMockOverrides = Partial<{
  [K in keyof ActivityRecordRepository]: ActivityRecordRepository[K] extends Write<infer F>
    ? F
    : ActivityRecordRepository[K];
}>;

function viewablePorts(opts: {
  activity?: LearningActivity;
  enrollment?: TrackEnrollment | null;
  records?: RecordMockOverrides;
}): Partial<Ports> {
  const enr = opts.enrollment === undefined ? enrollment : opts.enrollment;
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
      membership: vi.fn(async () => membership),
    } as unknown as StudyGroupRepository,
    tracks: {
      byId: vi.fn(async () => track),
      enrollment: vi.fn(async () => enr),
    } as unknown as LearningTrackRepository,
    policy: {
      getOperator: vi.fn(async () => null),
    } as unknown as InstanceAccessPolicyRepository,
    activities: {
      byId: vi.fn(async () => opts.activity ?? makeActivity()),
    } as unknown as LearningActivityRepository,
    records: {
      upsert: vi.fn(async () => record),
      byId: vi.fn(async () => null),
      byParticipantAndActivity: vi.fn(async () => null),
      listByActivity: vi.fn(async () => ({ records: [], nextCursor: null })),
      listByParticipant: vi.fn(async () => []),
      getPartProgress: vi.fn(async () => null),
      listPartProgress: vi.fn(async () => []),
      savePartProgress: vi.fn(),
      setPartCompletion: vi.fn(),
      setCompletion: vi.fn(),
      setVisibilityOverride: vi.fn(),
      appendPartHistory: vi.fn(),
      listPartHistory: vi.fn(async () => []),
      countPartHistory: vi.fn(async () => 0),
      reopenAgainstRevision: vi.fn(),
      flushEvidenceSignals: vi.fn(),
      ...opts.records,
    } as unknown as ActivityRecordRepository,
  };
}

/**
 * Re-point a `users` port so `byId` resolves to a viewer whose id is NOT the
 * record owner — exercises the viewability→404 path on the recordId reads
 * (the harness's default `users.byId` returns `actor` for any id, which would
 * spuriously satisfy the owner check).
 */
function asOtherViewer(users: Partial<Ports>["users"]): Partial<Ports>["users"] {
  return {
    ...users,
    byId: vi.fn(async () => ({ ...actor, id: otherId })),
  } as Partial<Ports>["users"];
}

describe("GET /api/v1/activities/:id/my-record", () => {
  it("returns canParticipate + empty parts for a participant with no record yet", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      canParticipate: boolean;
      visibilityOverride: string | null;
      parts: readonly unknown[];
      partHistoryCount: number;
      partsWithHistory: readonly string[];
    };
    expect(body.canParticipate).toBe(true);
    expect(body.visibilityOverride).toBeNull();
    expect(body.parts).toEqual([]);
    expect(body.partHistoryCount).toBe(0);
    expect(body.partsWithHistory).toEqual([]);
  });

  it("carries the history rollups for an existing record", async () => {
    const ports = viewablePorts({
      records: {
        byParticipantAndActivity: vi.fn(async () => record),
        listPartProgress: vi.fn(async () => []),
        countPartHistory: vi.fn(async () => 2),
        listPartHistory: vi.fn(async () => [
          {
            id: "ph_1",
            activityRecordId: record.id,
            partId: "p_quiz" as never,
            snapshot: { kind: "quiz" as const, completed: true, answers: [] },
            reason: "retry" as const,
            revisionIdAtTime: null,
            recordedAt: now,
          },
        ]),
      },
    });
    const app = harness({ userId: actorId, ports });
    const res = await app.request(`/api/v1/activities/${aid}/my-record`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      partHistoryCount: number;
      partsWithHistory: readonly string[];
    };
    expect(body.partHistoryCount).toBe(2);
    expect(body.partsWithHistory).toEqual(["p_quiz"]);
  });

  it("does not create a record on read (works under read_only killswitch)", async () => {
    const ports = viewablePorts({});
    const app = harness({ userId: actorId, ports, killswitchMode: "read_only" });
    const res = await app.request(`/api/v1/activities/${aid}/my-record`);
    expect(res.status).toBe(200);
    expect(ports.records?.upsert).not.toHaveBeenCalled();
  });

  it("404s a member excluded from a subset audience", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({
        activity: makeActivity({ audience: { kind: "subset", userIds: [otherId] } }),
      }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("401 when unauthenticated", async () => {
    const app = harness({ userId: null, ports: {} });
    const res = await app.request(`/api/v1/activities/${aid}/my-record`);
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/v1/activities/:id/my-record/parts/:partId/reflection", () => {
  it("saves a draft and returns word count + minWords", async () => {
    const ports = viewablePorts({});
    const app = harness({ userId: actorId, ports });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/parts/p_reflect/reflection`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "one two three" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      saved: boolean;
      wordCount: number;
      meetsMinWords: boolean;
    };
    expect(body).toEqual({ saved: true, wordCount: 3, meetsMinWords: true });
    expect(ports.records?.savePartProgress).toHaveBeenCalled();
  });

  it("403 not_track_enrollee for a member who isn't enrolled", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({ enrollment: null }) });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/parts/p_reflect/reflection`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_track_enrollee");
  });

  it("422 when writing to a non-reflection part", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_quiz/reflection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("part_kind_mismatch");
  });

  it("400 validation_failed on a malformed body", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/parts/p_reflect/reflection`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notText: 1 }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("503 read_only when the killswitch blocks writes", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}), killswitchMode: "read_only" });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/parts/p_reflect/reflection`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      },
    );
    expect(res.status).toBe(503);
  });
});

describe("PUT /api/v1/activities/:id/my-record/parts/:partId/quiz", () => {
  it("grades the submission and returns per-question verdicts + score", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [{ questionId: "q1", kind: "multiple_choice", selectedIndex: 1 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      perQuestion: ReadonlyArray<{
        questionId: string;
        verdict: string;
        correctIndex: number | null;
      }>;
      autoScore: { correct: number; gradeable: number };
    };
    expect(body.perQuestion).toEqual([{ questionId: "q1", verdict: "correct", correctIndex: 1 }]);
    expect(body.autoScore).toEqual({ correct: 1, gradeable: 1 });
  });

  it("422 when the answer set doesn't match the quiz", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [] }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("quiz_answers_mismatch");
  });
});

describe("PUT /api/v1/activities/:id/my-record/parts/:partId/completion", () => {
  it("marks a Part complete and echoes the new state", async () => {
    const ports = viewablePorts({});
    const app = harness({ userId: actorId, ports });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/parts/p_reflect/completion`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed: true }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partId: string; completed: boolean };
    expect(body).toEqual({ partId: "p_reflect", completed: true });
    expect(ports.records?.setPartCompletion).toHaveBeenCalled();
  });

  it("400 validation_failed on a non-boolean completed", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/parts/p_reflect/completion`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed: "yes" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("404 for an unknown part id", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_nope/completion`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    expect(res.status).toBe(404);
  });

  it("503 read_only when the killswitch blocks writes", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}), killswitchMode: "read_only" });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/parts/p_reflect/completion`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed: true }),
      },
    );
    expect(res.status).toBe(503);
  });
});

describe("PATCH /api/v1/activities/:id/my-record/visibility-override", () => {
  it("sets the override", async () => {
    const ports = viewablePorts({});
    const app = harness({ userId: actorId, ports });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/visibility-override`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preference: "private" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visibilityOverride: string | null };
    expect(body.visibilityOverride).toBe("private");
    expect(ports.records?.setVisibilityOverride).toHaveBeenCalledWith("ar_1", "private");
  });

  it("clears the override with null", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/visibility-override`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preference: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visibilityOverride: string | null };
    expect(body.visibilityOverride).toBeNull();
  });

  it("400 on an invalid preference value", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/visibility-override`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preference: "everyone" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/activities/:id/my-record/parts/:partId/quiz", () => {
  it("re-grades persisted answers without writing", async () => {
    const ports = viewablePorts({
      records: {
        byParticipantAndActivity: vi.fn(async () => record),
        getPartProgress: vi.fn(async () => ({
          id: "pp_1",
          activityRecordId: record.id,
          partId: "p_quiz" as never,
          state: {
            kind: "quiz" as const,
            completed: false,
            answers: [{ questionId: "q1", kind: "multiple_choice" as const, selectedIndex: 1 }],
          },
          updatedAt: now,
        })),
      },
    });
    const app = harness({ userId: actorId, ports });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      perQuestion: ReadonlyArray<{ questionId: string; verdict: string; correctIndex: number }>;
      autoScore: { correct: number; gradeable: number };
    };
    expect(body.perQuestion).toEqual([{ questionId: "q1", verdict: "correct", correctIndex: 1 }]);
    expect(body.autoScore).toEqual({ correct: 1, gradeable: 1 });
    expect(ports.records?.savePartProgress).not.toHaveBeenCalled();
  });

  it("returns null when no answers are stored yet", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({ records: { byParticipantAndActivity: vi.fn(async () => null) } }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_quiz/quiz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("422 when the part is not a quiz", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/parts/p_reflect/quiz`);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("part_kind_mismatch");
  });
});

describe("POST /api/v1/activities/:id/my-record/complete", () => {
  it("completes the record and echoes it under manual_mark", async () => {
    const ports = viewablePorts({
      records: { upsert: vi.fn(async () => record), setCompletion: vi.fn() },
    });
    const app = harness({ userId: actorId, ports });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completionState: string; completedAt: string | null };
    expect(body.completionState).toBe("completed");
    expect(body.completedAt).not.toBeNull();
    expect(ports.records?.setCompletion).toHaveBeenCalled();
  });

  it("409 parts_incomplete under all_parts_complete with an unfinished Part", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({
        activity: makeActivity({ completionRule: { kind: "all_parts_complete" } }),
        records: {
          upsert: vi.fn(async () => record),
          listPartProgress: vi.fn(async () => []),
        },
      }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("parts_incomplete");
  });

  it("503 read_only when the killswitch blocks writes", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}), killswitchMode: "read_only" });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(503);
  });
});

describe("GET /api/v1/records/:id", () => {
  it("returns the full view with partHistoryCount + partsWithHistory", async () => {
    const partHistory = {
      id: "ph_1",
      activityRecordId: record.id,
      partId: "p_quiz" as never,
      snapshot: { kind: "quiz" as const, completed: true, answers: [] },
      reason: "retry" as const,
      revisionIdAtTime: null,
      recordedAt: now,
    };
    const countPartHistory = vi.fn(async () => 1);
    const listPartHistory = vi.fn(async () => [partHistory]);
    const app = harness({
      userId: actorId,
      ports: viewablePorts({
        records: {
          byId: vi.fn(async () => record),
          listPartProgress: vi.fn(async () => []),
          countPartHistory,
          listPartHistory,
        },
      }),
    });
    const res = await app.request(`/api/v1/records/${record.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      partHistoryCount: number;
      partsWithHistory: readonly string[];
    };
    expect(body.partHistoryCount).toBe(1);
    expect(body.partsWithHistory).toEqual(["p_quiz"]);
  });

  it("404 (not 403) for a non-owner — no enumeration oracle", async () => {
    const base = viewablePorts({ records: { byId: vi.fn(async () => record) } });
    const ports: Partial<Ports> = { ...base, users: asOtherViewer(base.users) };
    const app = harness({ userId: otherId, ports });
    const res = await app.request(`/api/v1/records/${record.id}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("404 for a record that does not exist", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({ records: { byId: vi.fn(async () => null) } }),
    });
    const res = await app.request("/api/v1/records/ar_missing");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/records/:id/history", () => {
  it("lists history and the count cross-checks the record view", async () => {
    const partHistory = (id: string) => ({
      id,
      activityRecordId: record.id,
      partId: "p_quiz" as never,
      snapshot: { kind: "quiz" as const, completed: true, answers: [] },
      reason: "retry" as const,
      revisionIdAtTime: null,
      recordedAt: now,
    });
    const ports = viewablePorts({
      records: {
        byId: vi.fn(async () => record),
        listPartProgress: vi.fn(async () => []),
        countPartHistory: vi.fn(async () => 2),
        listPartHistory: vi.fn(async () => [partHistory("ph_1"), partHistory("ph_2")]),
      },
    });
    const app = harness({ userId: actorId, ports });

    const view = await app.request(`/api/v1/records/${record.id}`);
    const viewBody = (await view.json()) as { partHistoryCount: number };

    const history = await app.request(`/api/v1/records/${record.id}/history?partId=p_quiz`);
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as readonly unknown[];
    expect(historyBody).toHaveLength(viewBody.partHistoryCount);
  });

  it("404 (not 403) for a non-owner", async () => {
    const base = viewablePorts({ records: { byId: vi.fn(async () => record) } });
    const ports: Partial<Ports> = { ...base, users: asOtherViewer(base.users) };
    const app = harness({ userId: otherId, ports });
    const res = await app.request(`/api/v1/records/${record.id}/history`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/activities/:id/participants/:participantId/reset", () => {
  const facilitatorPorts = (recordsOverride: RecordMockOverrides = {}) =>
    viewablePorts({
      enrollment: { ...enrollment, role: "facilitator" },
      records: {
        byParticipantAndActivity: vi.fn(async () => record),
        reopenAgainstRevision: vi.fn(),
        listPartProgress: vi.fn(async () => []),
        countPartHistory: vi.fn(async () => 0),
        listPartHistory: vi.fn(async () => []),
        ...recordsOverride,
      },
    });

  it("resets and returns the now-reset full view", async () => {
    const reopenAgainstRevision = vi.fn();
    const app = harness({
      userId: actorId,
      ports: facilitatorPorts({ reopenAgainstRevision }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants/${otherId}/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completionState: string };
    expect(body.completionState).toBe("in_progress");
    expect(reopenAgainstRevision).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "facilitator_reset", newRevisionId: null }),
    );
  });

  it("clears completion when resetting a completed record", async () => {
    const setCompletion = vi.fn();
    const completedRecord: ActivityRecord = {
      ...record,
      completionState: "completed",
      completedAt: new Date("2026-06-01T00:00:00.000Z"),
    };
    const app = harness({
      userId: actorId,
      ports: facilitatorPorts({
        byParticipantAndActivity: vi.fn(async () => completedRecord),
        setCompletion,
      }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants/${otherId}/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completionState: string; completedAt: string | null };
    expect(body.completionState).toBe("in_progress");
    expect(body.completedAt).toBeNull();
    expect(setCompletion).toHaveBeenCalledWith(expect.objectContaining({ state: "in_progress" }));
  });

  it("403 not_track_authority for a non-facilitator", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({
        records: { byParticipantAndActivity: vi.fn(async () => record) },
      }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants/${otherId}/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("not_track_authority");
  });

  it("404 when the participant has no record to reset", async () => {
    const app = harness({
      userId: actorId,
      ports: facilitatorPorts({ byParticipantAndActivity: vi.fn(async () => null) }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants/${otherId}/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("503 read_only when the killswitch blocks writes", async () => {
    const app = harness({
      userId: actorId,
      ports: facilitatorPorts(),
      killswitchMode: "read_only",
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants/${otherId}/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(503);
  });
});

describe("GET /api/v1/activities/:id/my-record/history", () => {
  const historyRow = {
    id: "ph_1",
    activityRecordId: record.id,
    partId: "p_quiz" as never,
    snapshot: { kind: "quiz" as const, completed: true, answers: [] },
    reason: "retry" as const,
    revisionIdAtTime: null,
    recordedAt: now,
  };

  it("lists the owner's history, resolving the record internally (no record id in path)", async () => {
    const listPartHistory = vi.fn(async () => [historyRow]);
    const ports = viewablePorts({
      records: { byParticipantAndActivity: vi.fn(async () => record), listPartHistory },
    });
    const app = harness({ userId: actorId, ports });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/history?partId=p_quiz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as readonly unknown[];
    expect(body).toHaveLength(1);
    expect(listPartHistory).toHaveBeenCalledWith(record.id, { partId: "p_quiz" });
  });

  it("returns [] for an owner with no record yet", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({ records: { byParticipantAndActivity: vi.fn(async () => null) } }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/history`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("404s a viewer outside a subset audience", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({
        activity: makeActivity({ audience: { kind: "subset", userIds: [otherId] } }),
      }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/my-record/history`);
    expect(res.status).toBe(404);
  });

  it("400 on an over-long partId query", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(
      `/api/v1/activities/${aid}/my-record/history?partId=${"p".repeat(65)}`,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/activities/:id/participants", () => {
  it("returns the participant roster for a facilitator", async () => {
    const app = harness({
      userId: actorId,
      ports: viewablePorts({
        enrollment: { ...enrollment, role: "facilitator" },
        records: {
          listByActivity: vi.fn(async () => ({
            records: [{ ...record, participantId: otherId }],
            nextCursor: null,
          })),
          countPartHistory: vi.fn(async () => 1),
        },
      }),
    });
    const res = await app.request(`/api/v1/activities/${aid}/participants`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: ReadonlyArray<{ participantId: string; partHistoryCount: number }>;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.participantId).toBe(otherId);
    expect(body.entries[0]?.partHistoryCount).toBe(1);
  });

  it("403 not_track_authority for a non-facilitator", async () => {
    const app = harness({ userId: actorId, ports: viewablePorts({}) });
    const res = await app.request(`/api/v1/activities/${aid}/participants`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("not_track_authority");
  });

  it("400 on an over-long activity id", async () => {
    const app = harness({ userId: actorId, ports: {} });
    const res = await app.request(`/api/v1/activities/${"a".repeat(65)}/participants`);
    expect(res.status).toBe(400);
  });
});

// Param-validation failure paths for the new + existing record routes — the
// zValidator error callbacks (an over-MAX_ID_LENGTH path segment) that the
// happy-path tests never trip.
describe("record route param validation (400 paths)", () => {
  const tooLong = "x".repeat(65);
  const cases: ReadonlyArray<readonly [string, string, RequestInit?]> = [
    ["GET my-record", `/api/v1/activities/${tooLong}/my-record`],
    [
      "GET my-record/parts/:partId/quiz",
      `/api/v1/activities/${aid}/my-record/parts/${tooLong}/quiz`,
    ],
    [
      "PUT reflection",
      `/api/v1/activities/${tooLong}/my-record/parts/p_x/reflection`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" },
    ],
    [
      "PUT quiz",
      `/api/v1/activities/${tooLong}/my-record/parts/p_x/quiz`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" },
    ],
    [
      "PUT completion",
      `/api/v1/activities/${tooLong}/my-record/parts/p_x/completion`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" },
    ],
    [
      "PATCH visibility-override",
      `/api/v1/activities/${tooLong}/my-record/visibility-override`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" },
    ],
    ["POST complete", `/api/v1/activities/${tooLong}/my-record/complete`, { method: "POST" }],
    ["GET record", `/api/v1/records/${tooLong}`],
    ["GET record history", `/api/v1/records/${tooLong}/history`],
    [
      "POST reset",
      `/api/v1/activities/${tooLong}/participants/${otherId}/reset`,
      { method: "POST" },
    ],
  ];

  for (const [label, path, init] of cases) {
    it(`400 on an over-long id — ${label}`, async () => {
      const app = harness({ userId: actorId, ports: {} });
      const res = await app.request(path, init);
      expect(res.status).toBe(400);
    });
  }
});
