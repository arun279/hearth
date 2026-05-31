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
    regexMatcher: {
      isValid: () => true,
      matches: (pattern: string, input: string) => new RegExp(pattern).test(input),
    },
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

function viewablePorts(opts: {
  activity?: LearningActivity;
  enrollment?: TrackEnrollment | null;
  records?: Partial<ActivityRecordRepository>;
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
      byParticipantAndActivity: vi.fn(async () => null),
      getPartProgress: vi.fn(async () => null),
      listPartProgress: vi.fn(async () => []),
      savePartProgress: vi.fn(),
      setVisibilityOverride: vi.fn(),
      ...opts.records,
    } as unknown as ActivityRecordRepository,
  };
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
    };
    expect(body.canParticipate).toBe(true);
    expect(body.visibilityOverride).toBeNull();
    expect(body.parts).toEqual([]);
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
