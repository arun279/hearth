import type {
  LearningActivity,
  LearningActivityDraft,
  LearningActivityId,
  LearningTrack,
  LearningTrackId,
} from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { createActivity } from "../src/use-cases/create-activity.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeActivities,
  makeGroups,
  makeLibrary,
  makePolicy,
  makeTracks,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const TRACK_ID = "t_1" as LearningTrackId;
const ACTIVITY_ID = "a_1" as LearningActivityId;

const ACTIVE_TRACK: LearningTrack = {
  id: TRACK_ID,
  groupId: GROUP_ID,
  name: "Beginner Spanish",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const baseDraft = (): LearningActivityDraft => ({
  trackId: TRACK_ID,
  title: "New activity",
  description: null,
  parts: [
    { kind: "write_reflection", id: "p1", prompt: "Reflect." },
    { kind: "write_reflection", id: "p2", prompt: "Again." },
  ],
  flow: { prereqs: [{ fromPartId: "p1", toPartId: "p2", kind: "hard" }] },
  audience: { kind: "everyone_enrolled" },
  window: null,
  postClosePolicy: null,
  completionRule: { kind: "manual_mark" },
  libraryRefs: [],
  prerequisiteActivityIds: [],
  suggestedNextActivityIds: [],
});

const created: LearningActivity = {
  id: ACTIVITY_ID,
  trackId: TRACK_ID,
  title: "New activity",
  description: null,
  parts: baseDraft().parts,
  flow: baseDraft().flow,
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
};

const baseDeps = () => ({
  users: makeUsers(ACTOR),
  groups: makeGroups({ byId: vi.fn(async () => ACTIVE_GROUP) }),
  tracks: makeTracks({
    byId: vi.fn(async () => ACTIVE_TRACK),
    enrollment: vi.fn(async () => ({
      trackId: TRACK_ID,
      userId: ACTOR_ID,
      role: "facilitator" as const,
      enrolledAt: TEST_NOW,
      leftAt: null,
    })),
    listEnrollments: vi.fn(async () => []),
  }),
  policy: makePolicy({ getOperator: vi.fn(async () => null) }),
  library: makeLibrary(),
  activities: makeActivities({ create: vi.fn(async () => created) }),
});

const baseMembership = () =>
  makeGroups({
    byId: vi.fn(async () => ACTIVE_GROUP),
    membership: vi.fn(async () => membership({ role: "participant" })),
  });

describe("createActivity", () => {
  it("facilitator can create a valid activity", async () => {
    const deps = baseDeps();
    deps.groups = baseMembership();
    const result = await createActivity({ actor: ACTOR_ID, draft: baseDraft() }, deps);
    expect(result.id).toBe(ACTIVITY_ID);
    expect(deps.activities.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: ACTOR_ID }),
    );
  });

  it("rejects when actor is not authority over the track", async () => {
    const deps = baseDeps();
    deps.groups = baseMembership();
    deps.tracks = makeTracks({
      byId: vi.fn(async () => ACTIVE_TRACK),
      enrollment: vi.fn(async () => null),
    });
    await expect(createActivity({ actor: ACTOR_ID, draft: baseDraft() }, deps)).rejects.toThrow(
      /Only a Group Admin or Track Facilitator/,
    );
  });

  it("rejects flow cycle in the hard sub-DAG", async () => {
    const deps = baseDeps();
    deps.groups = baseMembership();
    const draft: LearningActivityDraft = {
      ...baseDraft(),
      flow: {
        prereqs: [
          { fromPartId: "p1", toPartId: "p2", kind: "hard" },
          { fromPartId: "p2", toPartId: "p1", kind: "hard" },
        ],
      },
    };
    await expect(createActivity({ actor: ACTOR_ID, draft }, deps)).rejects.toThrow(/cycle/);
  });

  it("rejects window without post-close policy", async () => {
    const deps = baseDeps();
    deps.groups = baseMembership();
    const draft: LearningActivityDraft = {
      ...baseDraft(),
      window: { opensAt: 1, dueAt: 2, closesAt: 3 },
      postClosePolicy: null,
    };
    await expect(createActivity({ actor: ACTOR_ID, draft }, deps)).rejects.toThrow(
      /postClosePolicy is required/,
    );
  });

  it("rejects subset audience containing a non-enrollee", async () => {
    const deps = baseDeps();
    deps.groups = baseMembership();
    deps.tracks = makeTracks({
      byId: vi.fn(async () => ACTIVE_TRACK),
      enrollment: vi.fn(async () => ({
        trackId: TRACK_ID,
        userId: ACTOR_ID,
        role: "facilitator" as const,
        enrolledAt: TEST_NOW,
        leftAt: null,
      })),
      listEnrollments: vi.fn(async () => []),
    });
    const draft: LearningActivityDraft = {
      ...baseDraft(),
      audience: { kind: "subset", userIds: ["u_other" as never] },
    };
    await expect(createActivity({ actor: ACTOR_ID, draft }, deps)).rejects.toThrow(
      /not a current enrollee/,
    );
  });
});
