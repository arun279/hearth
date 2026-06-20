import type {
  ActivityPartId,
  ActivityRecord,
  ActivityRecordId,
  LearningActivity,
  LearningActivityId,
  LearningTrackId,
  LibraryRevisionId,
  PartHistory,
  TrackEnrollment,
} from "@hearth/domain";
import { markWrite } from "@hearth/ports";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gradeQuizAnswers } from "../src/use-cases/grade-quiz-answers.ts";
import { listPartHistory } from "../src/use-cases/list-part-history.ts";
import { markActivityComplete } from "../src/use-cases/mark-activity-complete.ts";
import { resetParticipantProgress } from "../src/use-cases/reset-participant-progress.ts";
import { revisionBumpRestart } from "../src/use-cases/revision-bump-restart.ts";
import { viewActivityRecord } from "../src/use-cases/view-activity-record.ts";
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
  makeTracks,
  makeUsers,
  membership,
  TARGET,
  TARGET_ID,
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
  return { trackId: TRACK_ID, userId: ACTOR_ID, role, enrolledAt: TEST_NOW, leftAt: null };
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
  enrollment?: TrackEnrollment | null;
  membershipRole?: "participant" | "admin";
  records?: ReturnType<typeof makeRecords>;
};

function depsOk(opts: DepsOpts = {}) {
  const activity = opts.activity ?? makeActivity();
  const enrollment = opts.enrollment === undefined ? enrolled() : opts.enrollment;
  return {
    users: makeUsers(ACTOR, TARGET),
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
    clock: { now: () => TEST_NOW },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("markActivityComplete", () => {
  it("completes immediately under manual_mark and is idempotent on re-run", async () => {
    const records = makeRecords({ upsert: markWrite(vi.fn(async () => record())) });
    const deps = depsOk({ records });
    const result = await markActivityComplete({ actor: ACTOR_ID, activityId: ACTIVITY_ID }, deps);
    expect(result.completionState).toBe("completed");
    expect(records.setCompletion).toHaveBeenCalledWith({
      id: RECORD_ID,
      state: "completed",
      at: TEST_NOW,
    });

    vi.clearAllMocks();
    const alreadyDone = makeRecords({
      upsert: markWrite(
        vi.fn(async () => record({ completionState: "completed", completedAt: TEST_NOW })),
      ),
    });
    const result2 = await markActivityComplete(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID },
      depsOk({ records: alreadyDone }),
    );
    expect(result2.completionState).toBe("completed");
    expect(alreadyDone.setCompletion).not.toHaveBeenCalled();
  });

  it("rejects with 409 parts_incomplete under all_parts_complete when a Part is unmarked", async () => {
    const activity = makeActivity({ completionRule: { kind: "all_parts_complete" } });
    const records = makeRecords({
      upsert: markWrite(vi.fn(async () => record())),
      listPartProgress: vi.fn(async () => []),
    });
    await expect(
      markActivityComplete(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID },
        depsOk({ records, activity }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "parts_incomplete" });
  });

  it("rejects a non-enrollee with 403", async () => {
    await expect(
      markActivityComplete(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID },
        depsOk({ enrollment: null }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("gradeQuizAnswers (re-grade on mount, no write)", () => {
  it("re-grades persisted answers WITHOUT issuing any D1 write", async () => {
    const records = makeRecords({
      byParticipantAndActivity: vi.fn(async () => record()),
      getPartProgress: vi.fn(async () => ({
        id: "pp",
        activityRecordId: RECORD_ID,
        partId: "p_quiz" as ActivityPartId,
        state: {
          kind: "quiz" as const,
          completed: true,
          answers: [{ questionId: "q_mc", kind: "multiple_choice" as const, selectedIndex: 1 }],
        },
        updatedAt: TEST_NOW,
      })),
    });
    const deps = depsOk({ records });
    const result = await gradeQuizAnswers(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz" },
      deps,
    );
    expect(result?.autoScore).toEqual({ correct: 1, gradeable: 1 });
    expect(result?.perQuestion[0]).toEqual({
      questionId: "q_mc",
      verdict: "correct",
      correctIndex: 1,
    });
    // Budget-critical: a completed-quiz mount must cost zero D1 writes.
    expect(records.savePartProgress).not.toHaveBeenCalled();
    expect(records.upsert).not.toHaveBeenCalled();
    expect(records.setPartCompletion).not.toHaveBeenCalled();
  });

  it("returns null when no answers are persisted yet", async () => {
    const records = makeRecords({ byParticipantAndActivity: vi.fn(async () => record()) });
    const deps = depsOk({ records });
    const result = await gradeQuizAnswers(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz" },
      deps,
    );
    expect(result).toBeNull();
  });

  it("returns null when the participant has no record at all", async () => {
    const deps = depsOk();
    const result = await gradeQuizAnswers(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, partId: "p_quiz" },
      deps,
    );
    expect(result).toBeNull();
  });
});

describe("viewActivityRecord", () => {
  it("projects the full view with history rollups for the participant", async () => {
    const history: PartHistory[] = [
      {
        id: "ph_1",
        activityRecordId: RECORD_ID,
        partId: "p_reflect" as ActivityPartId,
        snapshot: { kind: "write_reflection", completed: false, text: "old" },
        reason: "retry",
        revisionIdAtTime: null,
        recordedAt: TEST_NOW,
      },
    ];
    const records = makeRecords({
      byId: vi.fn(async () => record()),
      countPartHistory: vi.fn(async () => 1),
      listPartHistory: vi.fn(async () => history),
    });
    const deps = { users: makeUsers(ACTOR), records };
    const view = await viewActivityRecord({ actor: ACTOR_ID, recordId: RECORD_ID }, deps);
    expect(view.id).toBe(RECORD_ID);
    expect(view.partHistoryCount).toBe(1);
    expect(view.partsWithHistory).toEqual(["p_reflect"]);
  });

  it("404s (not 403) a non-owner — record id is not an enumeration oracle", async () => {
    const records = makeRecords({
      byId: vi.fn(async () => record({ participantId: TARGET_ID })),
    });
    const deps = { users: makeUsers(ACTOR), records };
    await expect(
      viewActivityRecord({ actor: ACTOR_ID, recordId: RECORD_ID }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("404s a missing record", async () => {
    const records = makeRecords({ byId: vi.fn(async () => null) });
    const deps = { users: makeUsers(ACTOR), records };
    await expect(
      viewActivityRecord({ actor: ACTOR_ID, recordId: RECORD_ID }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listPartHistory", () => {
  it("404s a non-owner before reading history", async () => {
    const records = makeRecords({
      byId: vi.fn(async () => record({ participantId: TARGET_ID })),
    });
    const deps = { users: makeUsers(ACTOR), records };
    await expect(
      listPartHistory({ actor: ACTOR_ID, recordId: RECORD_ID }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(records.listPartHistory).not.toHaveBeenCalled();
  });

  it("returns the owner's history, optionally filtered by partId", async () => {
    const records = makeRecords({ byId: vi.fn(async () => record()) });
    const deps = { users: makeUsers(ACTOR), records };
    await listPartHistory(
      { actor: ACTOR_ID, recordId: RECORD_ID, partId: "p_quiz" as ActivityPartId },
      deps,
    );
    expect(records.listPartHistory).toHaveBeenCalledWith(RECORD_ID, { partId: "p_quiz" });
  });
});

describe("resetParticipantProgress", () => {
  it("rejects a non-facilitator with 403 not_track_authority", async () => {
    const records = makeRecords({
      byParticipantAndActivity: vi.fn(async () => record({ participantId: TARGET_ID })),
    });
    const deps = depsOk({ records, enrollment: enrolled("participant") });
    await expect(
      resetParticipantProgress(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, participantId: TARGET_ID },
        deps,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_authority" });
    expect(records.reopenAgainstRevision).not.toHaveBeenCalled();
  });

  it("reopens ALL parts with reason=facilitator_reset for a facilitator", async () => {
    const targetRecord = { ...record(), participantId: TARGET_ID, id: RECORD_ID };
    const records = makeRecords({
      byParticipantAndActivity: vi.fn(async () => targetRecord),
    });
    const deps = depsOk({ records, enrollment: enrolled("facilitator") });
    await resetParticipantProgress(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, participantId: TARGET_ID },
      deps,
    );
    expect(records.reopenAgainstRevision).toHaveBeenCalledWith({
      recordId: RECORD_ID,
      newRevisionId: null,
      affectedPartIds: ["p_reflect", "p_quiz"],
      reason: "facilitator_reset",
    });
  });

  it("404s when the participant has no record to reset", async () => {
    const records = makeRecords({ byParticipantAndActivity: vi.fn(async () => null) });
    const deps = depsOk({ records, enrollment: enrolled("facilitator") });
    await expect(
      resetParticipantProgress(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, participantId: TARGET_ID },
        deps,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("revisionBumpRestart", () => {
  const ITEM_ID = "li_1";
  const OLD_REV = "lr_old" as LibraryRevisionId;
  const NEW_REV = "lr_new" as LibraryRevisionId;

  function libraryBackedActivity(): LearningActivity {
    return makeActivity({
      parts: [
        {
          kind: "read_library_item",
          id: "p_read",
          libraryItemId: ITEM_ID,
        } as never,
      ],
    });
  }

  it("reopens affected parts across every record on the activity", async () => {
    const recs = [record(), record({ id: "ar_2" as ActivityRecordId, participantId: TARGET_ID })];
    const records = makeRecords({
      listByActivity: vi.fn(async () => ({ records: recs, nextCursor: null })),
    });
    const deps = {
      activities: makeActivities({ byId: vi.fn(async () => libraryBackedActivity()) }),
      records,
    };
    const result = await revisionBumpRestart(
      {
        activityId: ACTIVITY_ID,
        libraryItemId: ITEM_ID,
        previousRevisionId: OLD_REV,
        newRevisionId: NEW_REV,
      },
      deps,
    );
    expect(result.affectedPartIds).toEqual(["p_read"]);
    expect(result.reopenedRecordCount).toBe(2);
    expect(records.reopenAgainstRevision).toHaveBeenCalledTimes(2);
    expect(records.reopenAgainstRevision).toHaveBeenCalledWith({
      recordId: RECORD_ID,
      newRevisionId: NEW_REV,
      affectedPartIds: ["p_read"],
      reason: "revision_bump",
    });
  });

  it("is a no-op when the revision is unchanged (idempotent re-run with same newRevisionId)", async () => {
    const records = makeRecords({
      listByActivity: vi.fn(async () => ({ records: [record()], nextCursor: null })),
    });
    const deps = {
      activities: makeActivities({ byId: vi.fn(async () => libraryBackedActivity()) }),
      records,
    };
    const result = await revisionBumpRestart(
      {
        activityId: ACTIVITY_ID,
        libraryItemId: ITEM_ID,
        previousRevisionId: NEW_REV,
        newRevisionId: NEW_REV,
      },
      deps,
    );
    expect(result.affectedPartIds).toEqual([]);
    expect(result.reopenedRecordCount).toBe(0);
    expect(records.reopenAgainstRevision).not.toHaveBeenCalled();
    expect(records.listByActivity).not.toHaveBeenCalled();
  });
});
