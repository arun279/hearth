import type {
  ActivityRecord,
  ActivityRecordId,
  LearningActivity,
  LearningActivityId,
  LearningTrack,
  LearningTrackId,
  LibraryRevisionId,
  PartProgress,
  PartProgressState,
  UserId,
} from "@hearth/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markActivityComplete } from "../src/use-cases/mark-activity-complete.ts";
import { resetParticipantProgress } from "../src/use-cases/reset-participant-progress.ts";
import { revisionBumpRestart } from "../src/use-cases/revision-bump-restart.ts";
import { savePartProgress } from "../src/use-cases/save-part-progress.ts";
import { setRecordVisibilityOverride } from "../src/use-cases/set-record-visibility-override.ts";
import { startOrResumeActivity } from "../src/use-cases/start-or-resume-activity.ts";
import { submitQuizAnswers } from "../src/use-cases/submit-quiz-answers.ts";
import { viewActivityRecord } from "../src/use-cases/view-activity-record.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeActivities,
  makeGroups,
  makePolicy,
  makeRecords,
  makeTracks,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const TRACK_ID = "t_1" as LearningTrackId;
const ACTIVITY_ID = "a_1" as LearningActivityId;
const RECORD_ID = "ar_1" as ActivityRecordId;
const OTHER_ID = "u_other" as UserId;

const TRACK: LearningTrack = {
  id: TRACK_ID,
  groupId: GROUP_ID,
  name: "T",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

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

function progress(partId: string, state: PartProgressState): PartProgress {
  return {
    id: `pp_${partId}`,
    activityRecordId: RECORD_ID,
    partId: partId as never,
    state,
    updatedAt: TEST_NOW,
  };
}

function makeActivity(overrides: Partial<LearningActivity> = {}): LearningActivity {
  return {
    id: ACTIVITY_ID,
    trackId: TRACK_ID,
    title: "A",
    description: null,
    parts: [
      { kind: "write_reflection", id: "p_reflect", prompt: "Reflect." },
      { kind: "embed", id: "p_embed", provider: "youtube", url: "https://youtube.com/watch?v=x" },
    ],
    flow: { prereqs: [], displayOrder: ["p_reflect", "p_embed"] },
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

type CtxOpts = {
  readonly role?: "participant" | "facilitator";
  readonly adminMembership?: boolean;
  readonly activity?: LearningActivity;
};

function ctxDeps(opts: CtxOpts = {}) {
  const role = opts.role ?? "participant";
  const users = makeUsers(ACTOR);
  const groups = makeGroups({
    byId: vi.fn(async () => ACTIVE_GROUP),
    membership: vi.fn(async () =>
      membership({ role: opts.adminMembership ? "admin" : "participant" }),
    ),
  });
  const tracks = makeTracks({
    byId: vi.fn(async () => TRACK),
    enrollment: vi.fn(async () => ({
      trackId: TRACK_ID,
      userId: ACTOR_ID,
      role,
      enrolledAt: TEST_NOW,
      leftAt: null,
    })),
  });
  const activities = makeActivities({ byId: vi.fn(async () => opts.activity ?? makeActivity()) });
  const policy = makePolicy({ getOperator: vi.fn(async () => null) });
  const clock = { now: () => TEST_NOW };
  return { users, groups, tracks, activities, policy, clock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startOrResumeActivity", () => {
  it("upserts the record and returns the resume view with history fan-out", async () => {
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => [
        progress("p_reflect", { kind: "write_reflection", completed: true, text: "hi" }),
      ]),
      listPartHistory: vi.fn(async () => [
        {
          id: "h1",
          activityRecordId: RECORD_ID,
          partId: "p_reflect" as never,
          snapshot: { kind: "write_reflection", completed: false, text: "" },
          reason: "retry" as const,
          revisionIdAtTime: null,
          recordedAt: TEST_NOW,
        },
      ]),
      countPartHistory: vi.fn(async () => 1),
    });
    const result = await startOrResumeActivity(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID },
      { ...ctxDeps(), records },
    );
    expect(records.upsert).toHaveBeenCalledWith({
      activityId: ACTIVITY_ID,
      participantId: ACTOR_ID,
      now: TEST_NOW,
    });
    expect(result.record.id).toBe(RECORD_ID);
    expect(result.partProgress).toHaveLength(1);
    expect(result.partsWithHistory).toEqual(["p_reflect"]);
    expect(result.partHistoryCount).toBe(1);
  });

  it("404s for a non-viewer (group membership absent)", async () => {
    const deps = ctxDeps();
    deps.groups.membership = vi.fn(async () => null);
    await expect(
      startOrResumeActivity(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID },
        { ...deps, records: makeRecords() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("savePartProgress", () => {
  it("rejects saving a part whose hard prerequisite is unmet (prereq_not_met)", async () => {
    const activity = makeActivity({
      flow: { prereqs: [{ fromPartId: "p_reflect", toPartId: "p_embed", kind: "hard" }] },
    });
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => []),
    });
    await expect(
      savePartProgress(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          partId: "p_embed" as never,
          state: { kind: "embed", completed: true },
        },
        { ...ctxDeps({ activity }), records },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "prereq_not_met" });
    expect(records.savePartProgress).not.toHaveBeenCalled();
  });

  it("404s when the partId is not in the activity", async () => {
    const records = makeRecords({ upsert: vi.fn(async () => record()) });
    await expect(
      savePartProgress(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          partId: "p_missing" as never,
          state: { kind: "embed", completed: true },
        },
        { ...ctxDeps(), records },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("auto-completes under all_parts_complete only when the LAST part lands", async () => {
    const activity = makeActivity({ completionRule: { kind: "all_parts_complete" } });
    const setCompletion = vi.fn(async () =>
      record({ completionState: "completed", completedAt: TEST_NOW }),
    );
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      // p_embed already complete; saving p_reflect completes the set.
      listPartProgress: vi.fn(async () => [
        progress("p_embed", { kind: "embed", completed: true }),
      ]),
      savePartProgress: vi.fn(async () =>
        progress("p_reflect", { kind: "write_reflection", completed: true, text: "done" }),
      ),
      setCompletion,
    });
    const result = await savePartProgress(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        partId: "p_reflect" as never,
        state: { kind: "write_reflection", completed: true, text: "done" },
      },
      { ...ctxDeps({ activity }), records },
    );
    expect(setCompletion).toHaveBeenCalledWith({ id: RECORD_ID, state: "completed", at: TEST_NOW });
    expect(result.record.completionState).toBe("completed");
  });

  it("does NOT auto-complete when other parts remain incomplete", async () => {
    const activity = makeActivity({ completionRule: { kind: "all_parts_complete" } });
    const setCompletion = vi.fn();
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => []),
      savePartProgress: vi.fn(async () =>
        progress("p_reflect", { kind: "write_reflection", completed: true, text: "done" }),
      ),
      setCompletion,
    });
    await savePartProgress(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        partId: "p_reflect" as never,
        state: { kind: "write_reflection", completed: true, text: "done" },
      },
      { ...ctxDeps({ activity }), records },
    );
    expect(setCompletion).not.toHaveBeenCalled();
  });

  it("does NOT auto-complete under manual_mark even when every part is done", async () => {
    const setCompletion = vi.fn();
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => [
        progress("p_embed", { kind: "embed", completed: true }),
      ]),
      savePartProgress: vi.fn(async () =>
        progress("p_reflect", { kind: "write_reflection", completed: true, text: "x" }),
      ),
      setCompletion,
    });
    await savePartProgress(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        partId: "p_reflect" as never,
        state: { kind: "write_reflection", completed: true, text: "x" },
      },
      { ...ctxDeps(), records },
    );
    expect(setCompletion).not.toHaveBeenCalled();
  });
});

describe("submitQuizAnswers", () => {
  function quizActivity(): LearningActivity {
    return makeActivity({
      parts: [
        {
          kind: "quiz",
          id: "p_quiz",
          questions: [
            {
              id: "q_mc",
              prompt: "Pick",
              shape: { kind: "multiple_choice", options: ["A", "B"], answerKeyIndex: 1 },
              explainAfterAnswer: "B because.",
            },
            {
              id: "q_sa",
              prompt: "City?",
              shape: { kind: "short_answer", answerKeyRegex: "paris" },
            },
          ],
        },
      ],
      flow: { prereqs: [], displayOrder: ["p_quiz"] },
    });
  }

  it("grades server-side, builds answers with reveal, and snapshots prior as retry", async () => {
    let saved: PartProgressState | undefined;
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => []),
      savePartProgress: vi.fn(async (input) => {
        saved = input.state;
        return progress("p_quiz", input.state);
      }),
    });
    const result = await submitQuizAnswers(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        partId: "p_quiz" as never,
        submission: {
          answers: [
            { questionId: "q_mc", response: { kind: "multiple_choice", selectedIndex: 1 } },
            { questionId: "q_sa", response: { kind: "short_answer", text: "Paris" } },
          ],
        },
      },
      { ...ctxDeps({ activity: quizActivity() }), records },
    );

    expect(result.partProgress.partId).toBe("p_quiz");
    // snapshotPriorAsRetry must be set so a re-submission archives the prior attempt.
    expect(records.savePartProgress).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotPriorAsRetry: true }),
    );
    expect(saved?.kind).toBe("quiz");
    if (saved?.kind !== "quiz") throw new Error("expected quiz state");
    const [mc, sa] = saved.answers;
    expect(mc?.result).toBe("correct");
    expect(mc?.correctIndex).toBe(1);
    expect(mc?.explanation).toBe("B because.");
    // Short-answer matched case-insensitively → correct; no MC correctIndex.
    expect(sa?.result).toBe("correct");
    expect(sa?.correctIndex).toBeUndefined();
  });

  it("preserves a prior completed flag on re-submission", async () => {
    let saved: PartProgressState | undefined;
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => [
        progress("p_quiz", { kind: "quiz", completed: true, answers: [] }),
      ]),
      savePartProgress: vi.fn(async (input) => {
        saved = input.state;
        return progress("p_quiz", input.state);
      }),
    });
    await submitQuizAnswers(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        partId: "p_quiz" as never,
        submission: {
          answers: [
            { questionId: "q_mc", response: { kind: "multiple_choice", selectedIndex: 0 } },
          ],
        },
      },
      { ...ctxDeps({ activity: quizActivity() }), records },
    );
    expect(saved?.completed).toBe(true);
  });

  it("rejects a submission against a non-quiz part", async () => {
    const records = makeRecords({ upsert: vi.fn(async () => record()) });
    await expect(
      submitQuizAnswers(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          partId: "p_reflect" as never,
          submission: { answers: [] },
        },
        { ...ctxDeps(), records },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "part_kind_mismatch" });
  });
});

describe("markActivityComplete", () => {
  it("manual_mark completes directly", async () => {
    const setCompletion = vi.fn(async () =>
      record({ completionState: "completed", completedAt: TEST_NOW }),
    );
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => []),
      setCompletion,
    });
    const result = await markActivityComplete(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID },
      { ...ctxDeps(), records },
    );
    expect(result.completionState).toBe("completed");
    expect(setCompletion).toHaveBeenCalled();
  });

  it("all_parts_complete refuses when parts are incomplete (parts_incomplete)", async () => {
    const activity = makeActivity({ completionRule: { kind: "all_parts_complete" } });
    const records = makeRecords({
      upsert: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => []),
    });
    await expect(
      markActivityComplete(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID },
        { ...ctxDeps({ activity }), records },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "parts_incomplete" });
  });
});

describe("setRecordVisibilityOverride", () => {
  it("sets the override for the record owner", async () => {
    const setVisibilityOverride = vi.fn(async () => record({ visibilityOverride: "private" }));
    const records = makeRecords({ byId: vi.fn(async () => record()), setVisibilityOverride });
    const result = await setRecordVisibilityOverride(
      { actor: ACTOR_ID, recordId: RECORD_ID, override: "private" },
      { users: makeUsers(ACTOR), records, clock: { now: () => TEST_NOW } },
    );
    expect(setVisibilityOverride).toHaveBeenCalledWith({
      id: RECORD_ID,
      override: "private",
      now: TEST_NOW,
    });
    expect(result.visibilityOverride).toBe("private");
  });

  it("rejects a non-owner (not_record_owner)", async () => {
    const records = makeRecords({
      byId: vi.fn(async () => record({ participantId: OTHER_ID })),
    });
    await expect(
      setRecordVisibilityOverride(
        { actor: ACTOR_ID, recordId: RECORD_ID, override: null },
        { users: makeUsers(ACTOR), records, clock: { now: () => TEST_NOW } },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_record_owner" });
  });

  it("404s on a missing record", async () => {
    const records = makeRecords({ byId: vi.fn(async () => null) });
    await expect(
      setRecordVisibilityOverride(
        { actor: ACTOR_ID, recordId: RECORD_ID, override: null },
        { users: makeUsers(ACTOR), records, clock: { now: () => TEST_NOW } },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("viewActivityRecord", () => {
  it("returns full scope for the record owner", async () => {
    const records = makeRecords({
      byId: vi.fn(async () => record()),
      listPartProgress: vi.fn(async () => []),
      listPartHistory: vi.fn(async () => []),
      countPartHistory: vi.fn(async () => 0),
    });
    const result = await viewActivityRecord(
      { actor: ACTOR_ID, recordId: RECORD_ID },
      { ...ctxDeps(), records },
    );
    expect(result.scope).toBe("full");
    expect(result.record.id).toBe(RECORD_ID);
  });

  it("returns full scope for a facilitator viewing another's record", async () => {
    const records = makeRecords({
      byId: vi.fn(async () => record({ participantId: OTHER_ID })),
      listPartProgress: vi.fn(async () => []),
      listPartHistory: vi.fn(async () => []),
      countPartHistory: vi.fn(async () => 0),
    });
    const result = await viewActivityRecord(
      { actor: ACTOR_ID, recordId: RECORD_ID },
      { ...ctxDeps({ role: "facilitator" }), records },
    );
    expect(result.scope).toBe("full");
  });

  it("404s (hides existence) for a non-authority viewing another's record", async () => {
    const records = makeRecords({ byId: vi.fn(async () => record({ participantId: OTHER_ID })) });
    await expect(
      viewActivityRecord(
        { actor: ACTOR_ID, recordId: RECORD_ID },
        { ...ctxDeps({ role: "participant" }), records },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("resetParticipantProgress", () => {
  it("reopens the target's record as facilitator_reset for a track authority", async () => {
    const reopenAgainstRevision = vi.fn(async () => {});
    const target = record({ id: "ar_target" as ActivityRecordId, participantId: OTHER_ID });
    const records = makeRecords({
      byParticipantAndActivity: vi.fn(async () => target),
      byId: vi.fn(async () => target),
      reopenAgainstRevision,
      listPartProgress: vi.fn(async () => []),
      listPartHistory: vi.fn(async () => []),
      countPartHistory: vi.fn(async () => 0),
    });
    await resetParticipantProgress(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, participantId: OTHER_ID },
      { ...ctxDeps({ role: "facilitator" }), records },
    );
    expect(reopenAgainstRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: "ar_target",
        reason: "facilitator_reset",
        revisionIdAtTime: null,
      }),
    );
    const call = reopenAgainstRevision.mock.calls[0]?.[0];
    expect(call?.resets.map((r: { partId: string }) => r.partId).sort()).toEqual([
      "p_embed",
      "p_reflect",
    ]);
  });

  it("rejects a non-authority (not a facilitator/admin)", async () => {
    const records = makeRecords();
    await expect(
      resetParticipantProgress(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, participantId: OTHER_ID },
        { ...ctxDeps({ role: "participant" }), records },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(records.reopenAgainstRevision).not.toHaveBeenCalled();
  });

  it("404s when the target participant has no record", async () => {
    const records = makeRecords({ byParticipantAndActivity: vi.fn(async () => null) });
    await expect(
      resetParticipantProgress(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, participantId: OTHER_ID },
        { ...ctxDeps({ role: "facilitator" }), records },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("revisionBumpRestart", () => {
  const NEW_REV = "lr_new" as LibraryRevisionId;

  function libraryActivity(): LearningActivity {
    return makeActivity({
      parts: [
        { kind: "read_library_item", id: "p_read", libraryItemId: "li_1", title: "Ch 1" },
        { kind: "write_reflection", id: "p_reflect", prompt: "Reflect." },
      ],
      libraryRefs: [
        { id: "alr_1", activityId: ACTIVITY_ID, libraryItemId: "li_1", pinnedRevisionId: null },
      ],
    });
  }

  it("reopens the affected (unpinned) part on every record of the activity", async () => {
    const reopenAgainstRevision = vi.fn(async () => {});
    const records = makeRecords({
      listByActivity: vi.fn(async () => [
        record({ id: "ar_a" as ActivityRecordId }),
        record({ id: "ar_b" as ActivityRecordId, participantId: OTHER_ID }),
      ]),
      reopenAgainstRevision,
    });
    const activities = makeActivities({ byId: vi.fn(async () => libraryActivity()) });
    await revisionBumpRestart(
      { activityId: ACTIVITY_ID, bumpedLibraryItemId: "li_1", newRevisionId: NEW_REV },
      { activities, records, clock: { now: () => TEST_NOW } },
    );
    expect(reopenAgainstRevision).toHaveBeenCalledTimes(2);
    const call = reopenAgainstRevision.mock.calls[0]?.[0];
    expect(call?.reason).toBe("revision_bump");
    expect(call?.revisionIdAtTime).toBe(NEW_REV);
    expect(call?.resets.map((r: { partId: string }) => r.partId)).toEqual(["p_read"]);
  });

  it("is a no-op when the bumped item is pinned (no affected parts)", async () => {
    const reopenAgainstRevision = vi.fn(async () => {});
    const pinned = makeActivity({
      parts: [{ kind: "read_library_item", id: "p_read", libraryItemId: "li_1", title: "Ch 1" }],
      libraryRefs: [
        { id: "alr_1", activityId: ACTIVITY_ID, libraryItemId: "li_1", pinnedRevisionId: "lr_old" },
      ],
    });
    const activities = makeActivities({ byId: vi.fn(async () => pinned) });
    const records = makeRecords({ reopenAgainstRevision });
    await revisionBumpRestart(
      { activityId: ACTIVITY_ID, bumpedLibraryItemId: "li_1", newRevisionId: NEW_REV },
      { activities, records, clock: { now: () => TEST_NOW } },
    );
    expect(reopenAgainstRevision).not.toHaveBeenCalled();
  });

  it("returns early when the activity is missing", async () => {
    const records = makeRecords();
    const activities = makeActivities({ byId: vi.fn(async () => null) });
    await revisionBumpRestart(
      { activityId: ACTIVITY_ID, bumpedLibraryItemId: "li_1", newRevisionId: NEW_REV },
      { activities, records, clock: { now: () => TEST_NOW } },
    );
    expect(records.listByActivity).not.toHaveBeenCalled();
  });
});
