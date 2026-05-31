import type {
  ActivityPartId,
  ActivityRecord,
  ActivityRecordId,
  LearningActivity,
  LearningActivityDraft,
  LearningActivityId,
  LearningTrackId,
  PartProgress,
  TrackEnrollment,
} from "@hearth/domain";
import { markWrite } from "@hearth/ports";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActivity } from "../src/use-cases/create-activity.ts";
import { getMyActivityRecord } from "../src/use-cases/get-my-activity-record.ts";
import { saveReflectionDraft } from "../src/use-cases/save-reflection-draft.ts";
import { setPartCompleted } from "../src/use-cases/set-part-completed.ts";
import { setRecordVisibilityOverride } from "../src/use-cases/set-record-visibility-override.ts";
import { submitQuizAnswers } from "../src/use-cases/submit-quiz-answers.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeActivities,
  makeGroups,
  makeLibrary,
  makePolicy,
  makeRecords,
  makeRegexMatcher,
  makeTracks,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const TRACK_ID = "t_1" as LearningTrackId;
const ACTIVITY_ID = "a_1" as LearningActivityId;
const RECORD_ID = "ar_1" as ActivityRecordId;

const track = {
  id: TRACK_ID,
  groupId: GROUP_ID,
  name: "T",
  description: null,
  status: "active" as const,
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

function enrolled(role: "participant" | "facilitator" = "participant"): TrackEnrollment {
  return {
    trackId: TRACK_ID,
    userId: ACTOR_ID,
    role,
    enrolledAt: TEST_NOW,
    leftAt: null,
  };
}

function makeActivity(overrides: Partial<LearningActivity> = {}): LearningActivity {
  return {
    id: ACTIVITY_ID,
    trackId: TRACK_ID,
    title: "A",
    description: null,
    parts: [
      { kind: "write_reflection", id: "p_reflect", prompt: "Why?", minWords: 5 },
      {
        kind: "quiz",
        id: "p_quiz",
        questions: [
          {
            id: "q_mc",
            prompt: "Pick",
            shape: { kind: "multiple_choice", options: ["a", "b", "c"], answerKeyIndex: 1 },
          },
          { id: "q_sa", prompt: "Type", shape: { kind: "short_answer", answerKeyRegex: "^yes$" } },
          { id: "q_nokey", prompt: "Open", shape: { kind: "short_answer" } },
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
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}

function record(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: RECORD_ID,
    activityId: ACTIVITY_ID,
    participantId: ACTOR_ID,
    completionState: "in_progress",
    completedAt: null,
    visibilityOverride: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}

type DepsOpts = {
  activity?: LearningActivity;
  now?: Date;
  enrollment?: TrackEnrollment | null;
  membershipRole?: "participant" | "admin";
  records?: ReturnType<typeof makeRecords>;
  regexMatcher?: ReturnType<typeof makeRegexMatcher>;
};

function depsOk(opts: DepsOpts = {}) {
  const activity = opts.activity ?? makeActivity();
  const now = opts.now ?? TEST_NOW;
  const enrollment = opts.enrollment === undefined ? enrolled() : opts.enrollment;
  return {
    users: makeUsers(ACTOR),
    groups: makeGroups({
      byId: vi.fn(async () => ACTIVE_GROUP),
      membership: vi.fn(async () => membership({ role: opts.membershipRole ?? "participant" })),
    }),
    tracks: makeTracks({
      byId: vi.fn(async () => track),
      enrollment: vi.fn(async () => enrollment),
    }),
    policy: makePolicy({ getOperator: vi.fn(async () => null) }),
    activities: makeActivities({ byId: vi.fn(async () => activity) }),
    library: makeLibrary(),
    records: opts.records ?? makeRecords({ upsert: markWrite(vi.fn(async () => record())) }),
    regexMatcher: opts.regexMatcher ?? makeRegexMatcher(),
    clock: { now: () => now },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMyActivityRecord", () => {
  it("returns canParticipate=true and an empty part list before any write (no upsert)", async () => {
    const deps = depsOk();
    const view = await getMyActivityRecord({ actor: ACTOR_ID, activityId: ACTIVITY_ID }, deps);
    expect(view.canParticipate).toBe(true);
    expect(view.parts).toEqual([]);
    expect(view.visibilityOverride).toBeNull();
    expect(deps.records.upsert).not.toHaveBeenCalled();
  });

  it("hydrates parts + visibility from an existing record", async () => {
    const progress: PartProgress = {
      id: "pp_1",
      activityRecordId: RECORD_ID,
      partId: "p_reflect" as ActivityPartId,
      state: { kind: "write_reflection", completed: false, text: "draft" },
      updatedAt: TEST_NOW,
    };
    const deps = depsOk({
      records: makeRecords({
        byParticipantAndActivity: vi.fn(async () => record({ visibilityOverride: "private" })),
        listPartProgress: vi.fn(async () => [progress]),
      }),
    });
    const view = await getMyActivityRecord({ actor: ACTOR_ID, activityId: ACTIVITY_ID }, deps);
    expect(view.canParticipate).toBe(true);
    expect(view.visibilityOverride).toBe("private");
    expect(view.parts).toEqual([{ partId: "p_reflect", state: progress.state }]);
  });

  it("returns canParticipate=false for a member who is not enrolled (read-only viewer)", async () => {
    const deps = depsOk({ enrollment: null });
    const view = await getMyActivityRecord({ actor: ACTOR_ID, activityId: ACTIVITY_ID }, deps);
    expect(view.canParticipate).toBe(false);
    expect(view.parts).toEqual([]);
  });

  it("404s a viewer outside a subset audience (existence hidden)", async () => {
    const deps = depsOk({
      activity: makeActivity({ audience: { kind: "subset", userIds: ["u_other" as never] } }),
      membershipRole: "participant",
    });
    await expect(
      getMyActivityRecord({ actor: ACTOR_ID, activityId: ACTIVITY_ID }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("saveReflectionDraft", () => {
  it("saves the draft, preserves completed, reports word count + minWords", async () => {
    const records = makeRecords({
      upsert: markWrite(vi.fn(async () => record())),
      getPartProgress: vi.fn(async () => ({
        id: "pp",
        activityRecordId: RECORD_ID,
        partId: "p_reflect" as ActivityPartId,
        state: { kind: "write_reflection" as const, completed: true, text: "old" },
        updatedAt: TEST_NOW,
      })),
    });
    const deps = depsOk({ records });
    const result = await saveReflectionDraft(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", text: "one two three" },
      deps,
    );
    expect(result).toEqual({ saved: true, wordCount: 3, meetsMinWords: false });
    expect(records.savePartProgress).toHaveBeenCalledWith({
      activityRecordId: RECORD_ID,
      partId: "p_reflect",
      state: { kind: "write_reflection", completed: true, text: "one two three" },
    });
  });

  it("meetsMinWords is true at/above the threshold", async () => {
    const deps = depsOk();
    const result = await saveReflectionDraft(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", text: "a b c d e f" },
      deps,
    );
    expect(result.meetsMinWords).toBe(true);
  });

  it("rejects a non-enrollee with 403 not_track_enrollee", async () => {
    const deps = depsOk({ enrollment: null });
    await expect(
      saveReflectionDraft(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", text: "hi" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_enrollee" });
  });

  it("rejects writing to a non-reflection part", async () => {
    const deps = depsOk();
    await expect(
      saveReflectionDraft(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz", text: "hi" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "part_kind_mismatch" });
  });

  it("404s an unknown part id", async () => {
    const deps = depsOk();
    await expect(
      saveReflectionDraft(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_nope", text: "hi" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("409s when the activity window is closed (visible_locked)", async () => {
    const closedAt = new Date("2026-05-01T00:00:00.000Z").getTime();
    const deps = depsOk({
      activity: makeActivity({
        window: { opensAt: null, dueAt: null, closesAt: closedAt },
        postClosePolicy: { kind: "visible_locked" },
      }),
      now: new Date("2026-05-02T00:00:00.000Z"),
    });
    await expect(
      saveReflectionDraft(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", text: "hi" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "activity_closed" });
  });

  it("409s when the activity window is pre-open (activity_not_open)", async () => {
    const deps = depsOk({
      activity: makeActivity({
        window: {
          opensAt: new Date("2026-06-01T00:00:00.000Z").getTime(),
          dueAt: null,
          closesAt: null,
        },
        postClosePolicy: null,
      }),
      now: new Date("2026-05-02T00:00:00.000Z"),
    });
    await expect(
      saveReflectionDraft(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", text: "hi" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "activity_not_open" });
  });

  it("404s when the activity is post-close hidden (not_found)", async () => {
    const deps = depsOk({
      activity: makeActivity({
        window: {
          opensAt: null,
          dueAt: null,
          closesAt: new Date("2026-05-01T00:00:00.000Z").getTime(),
        },
        postClosePolicy: { kind: "hidden" },
      }),
      now: new Date("2026-05-02T00:00:00.000Z"),
    });
    await expect(
      saveReflectionDraft(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", text: "hi" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_found" });
  });
});

describe("submitQuizAnswers", () => {
  const answers = [
    { questionId: "q_mc", kind: "multiple_choice" as const, selectedIndex: 1 },
    { questionId: "q_sa", kind: "short_answer" as const, text: "yes" },
    { questionId: "q_nokey", kind: "short_answer" as const, text: "whatever" },
  ];

  it("grades each answer and aggregates score over gradeable questions only", async () => {
    const records = makeRecords({ upsert: markWrite(vi.fn(async () => record())) });
    const deps = depsOk({ records });
    const result = await submitQuizAnswers(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz", answers },
      deps,
    );
    expect(result.autoScore).toEqual({ correct: 2, gradeable: 2 });
    expect(result.perQuestion).toEqual([
      { questionId: "q_mc", verdict: "correct", correctIndex: 1 },
      { questionId: "q_sa", verdict: "correct", correctIndex: null },
      { questionId: "q_nokey", verdict: "no_key", correctIndex: null },
    ]);
    expect(records.savePartProgress).toHaveBeenCalledWith({
      activityRecordId: RECORD_ID,
      partId: "p_quiz",
      state: { kind: "quiz", completed: false, answers },
    });
  });

  it("marks a wrong multiple-choice answer incorrect", async () => {
    const deps = depsOk();
    const result = await submitQuizAnswers(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        partId: "p_quiz",
        answers: [
          { questionId: "q_mc", kind: "multiple_choice", selectedIndex: 0 },
          { questionId: "q_sa", kind: "short_answer", text: "no" },
          { questionId: "q_nokey", kind: "short_answer", text: "x" },
        ],
      },
      deps,
    );
    expect(result.autoScore).toEqual({ correct: 0, gradeable: 2 });
  });

  it("rejects a submission whose answer count differs from the quiz", async () => {
    const deps = depsOk();
    await expect(
      submitQuizAnswers(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          partId: "p_quiz",
          answers: [{ questionId: "q_mc", kind: "multiple_choice", selectedIndex: 1 }],
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "quiz_answers_mismatch" });
  });

  it("rejects an answer kind that doesn't match its question", async () => {
    const deps = depsOk();
    await expect(
      submitQuizAnswers(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          partId: "p_quiz",
          answers: [
            { questionId: "q_mc", kind: "short_answer", text: "b" },
            { questionId: "q_sa", kind: "short_answer", text: "yes" },
            { questionId: "q_nokey", kind: "short_answer", text: "x" },
          ],
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "quiz_answers_mismatch" });
  });

  it("rejects a non-enrollee with 403", async () => {
    const deps = depsOk({ enrollment: null });
    await expect(
      submitQuizAnswers(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz", answers },
        deps,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a duplicate answer for the same question", async () => {
    const deps = depsOk();
    await expect(
      submitQuizAnswers(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          partId: "p_quiz",
          answers: [
            { questionId: "q_mc", kind: "multiple_choice", selectedIndex: 1 },
            { questionId: "q_mc", kind: "multiple_choice", selectedIndex: 0 },
            { questionId: "q_sa", kind: "short_answer", text: "yes" },
          ],
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "quiz_answers_mismatch" });
  });

  it("preserves an existing completed flag across a re-submit", async () => {
    const records = makeRecords({
      upsert: markWrite(vi.fn(async () => record())),
      getPartProgress: vi.fn(async () => ({
        id: "pp",
        activityRecordId: RECORD_ID,
        partId: "p_quiz" as ActivityPartId,
        state: {
          kind: "quiz" as const,
          completed: true,
          answers: [{ questionId: "q_mc", kind: "multiple_choice" as const, selectedIndex: 0 }],
        },
        updatedAt: TEST_NOW,
      })),
    });
    const deps = depsOk({ records });
    await submitQuizAnswers(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz", answers },
      deps,
    );
    expect(records.savePartProgress).toHaveBeenCalledWith({
      activityRecordId: RECORD_ID,
      partId: "p_quiz",
      state: { kind: "quiz", completed: true, answers },
    });
  });
});

describe("setPartCompleted", () => {
  it("marks a reflection Part complete, preserving its text", async () => {
    const records = makeRecords({
      upsert: markWrite(vi.fn(async () => record())),
      getPartProgress: vi.fn(async () => ({
        id: "pp",
        activityRecordId: RECORD_ID,
        partId: "p_reflect" as ActivityPartId,
        state: { kind: "write_reflection" as const, completed: false, text: "my draft" },
        updatedAt: TEST_NOW,
      })),
    });
    const deps = depsOk({ records });
    const result = await setPartCompleted(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", completed: true },
      deps,
    );
    expect(result).toEqual({ partId: "p_reflect", completed: true });
    expect(records.savePartProgress).toHaveBeenCalledWith({
      activityRecordId: RECORD_ID,
      partId: "p_reflect",
      state: { kind: "write_reflection", completed: true, text: "my draft" },
    });
  });

  it("un-marks a quiz Part complete, preserving its answers", async () => {
    const answers = [{ questionId: "q_mc", kind: "multiple_choice" as const, selectedIndex: 1 }];
    const records = makeRecords({
      upsert: markWrite(vi.fn(async () => record())),
      getPartProgress: vi.fn(async () => ({
        id: "pp",
        activityRecordId: RECORD_ID,
        partId: "p_quiz" as ActivityPartId,
        state: { kind: "quiz" as const, completed: true, answers },
        updatedAt: TEST_NOW,
      })),
    });
    const deps = depsOk({ records });
    const result = await setPartCompleted(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz", completed: false },
      deps,
    );
    expect(result).toEqual({ partId: "p_quiz", completed: false });
    expect(records.savePartProgress).toHaveBeenCalledWith({
      activityRecordId: RECORD_ID,
      partId: "p_quiz",
      state: { kind: "quiz", completed: false, answers },
    });
  });

  it("marks a freshly-touched Part complete from its initial state", async () => {
    const records = makeRecords({
      upsert: markWrite(vi.fn(async () => record())),
      getPartProgress: vi.fn(async () => null),
    });
    const deps = depsOk({ records });
    await setPartCompleted(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", completed: true },
      deps,
    );
    expect(records.savePartProgress).toHaveBeenCalledWith({
      activityRecordId: RECORD_ID,
      partId: "p_reflect",
      state: { kind: "write_reflection", completed: true, text: "" },
    });
  });

  it("rejects a non-enrollee with 403 not_track_enrollee", async () => {
    const deps = depsOk({ enrollment: null });
    await expect(
      setPartCompleted(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", completed: true },
        deps,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_enrollee" });
  });

  it("404s an unknown part id", async () => {
    const deps = depsOk();
    await expect(
      setPartCompleted(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_nope", completed: true },
        deps,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("409s when the activity window is closed (visible_locked)", async () => {
    const closedAt = new Date("2026-05-01T00:00:00.000Z").getTime();
    const deps = depsOk({
      activity: makeActivity({
        window: { opensAt: null, dueAt: null, closesAt: closedAt },
        postClosePolicy: { kind: "visible_locked" },
      }),
      now: new Date("2026-05-02T00:00:00.000Z"),
    });
    await expect(
      setPartCompleted(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_reflect", completed: true },
        deps,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "activity_closed" });
  });
});

describe("setRecordVisibilityOverride", () => {
  it("sets the override and echoes it back", async () => {
    const records = makeRecords({ upsert: markWrite(vi.fn(async () => record())) });
    const deps = depsOk({ records });
    const result = await setRecordVisibilityOverride(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, preference: "private" },
      deps,
    );
    expect(result).toEqual({ visibilityOverride: "private" });
    expect(records.setVisibilityOverride).toHaveBeenCalledWith(RECORD_ID, "private");
  });

  it("clears the override with null", async () => {
    const records = makeRecords({ upsert: markWrite(vi.fn(async () => record())) });
    const deps = depsOk({ records });
    await setRecordVisibilityOverride(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, preference: null },
      deps,
    );
    expect(records.setVisibilityOverride).toHaveBeenCalledWith(RECORD_ID, null);
  });

  it("is allowed even after the activity has closed (no accessState gate)", async () => {
    const closedAt = new Date("2026-05-01T00:00:00.000Z").getTime();
    const records = makeRecords({ upsert: markWrite(vi.fn(async () => record())) });
    const deps = depsOk({
      records,
      activity: makeActivity({
        window: { opensAt: null, dueAt: null, closesAt: closedAt },
        postClosePolicy: { kind: "visible_locked" },
      }),
      now: new Date("2026-05-02T00:00:00.000Z"),
    });
    await expect(
      setRecordVisibilityOverride(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, preference: "track_only" },
        deps,
      ),
    ).resolves.toEqual({ visibilityOverride: "track_only" });
  });

  it("rejects a non-enrollee with 403", async () => {
    const deps = depsOk({ enrollment: null });
    await expect(
      setRecordVisibilityOverride(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, preference: "private" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("createActivity — quiz answer-key compile validation", () => {
  function quizDraft(answerKeyRegex: string): LearningActivityDraft {
    return {
      trackId: TRACK_ID,
      title: "Quiz Activity",
      description: null,
      parts: [
        {
          kind: "quiz",
          id: "p_q",
          questions: [{ id: "q1", prompt: "?", shape: { kind: "short_answer", answerKeyRegex } }],
        },
      ],
      flow: { prereqs: [] },
      audience: { kind: "everyone_enrolled" },
      window: null,
      postClosePolicy: null,
      completionRule: { kind: "manual_mark" },
      libraryRefs: [],
      prerequisiteActivityIds: [],
      suggestedNextActivityIds: [],
    };
  }

  it("rejects an answer key that does not compile under the engine", async () => {
    const deps = depsOk({
      membershipRole: "admin",
      regexMatcher: makeRegexMatcher({ isValid: vi.fn(() => false) }),
    });
    await expect(
      createActivity({ actor: ACTOR_ID, draft: quizDraft("(") }, deps),
    ).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
      reason: "quiz_answer_key_regex_invalid",
    });
    expect(deps.activities.create).not.toHaveBeenCalled();
  });

  it("accepts a compilable answer key", async () => {
    const created = makeActivity();
    const deps = depsOk({ membershipRole: "admin" });
    deps.activities.create = markWrite(vi.fn(async () => created));
    await expect(
      createActivity({ actor: ACTOR_ID, draft: quizDraft("^yes$") }, deps),
    ).resolves.toBe(created);
  });
});
