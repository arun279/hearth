import type {
  ActivityRecord,
  ActivityRecordId,
  CompletionState,
  LearningActivityId,
  LearningTrack,
  LearningTrackId,
  PeerProgressVisibility,
  TrackEnrollment,
  TrackRole,
  UserId,
} from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { listTrackProgress } from "../src/use-cases/list-track-progress.ts";
import {
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
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
const ACT_1 = "act_1" as LearningActivityId;

function track(peerProgressVisibility: PeerProgressVisibility): LearningTrack {
  return {
    id: TRACK_ID,
    groupId: GROUP_ID,
    name: "T",
    description: null,
    status: "active",
    peerProgressVisibility,
    pausedAt: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
}

function enrollment(role: TrackRole): TrackEnrollment {
  return { trackId: TRACK_ID, userId: ACTOR_ID, role, enrolledAt: TEST_NOW, leftAt: null };
}

function rec(id: string, participantId: UserId, state: CompletionState): ActivityRecord {
  return {
    id: id as ActivityRecordId,
    activityId: ACT_1,
    participantId,
    completionState: state,
    completedAt: state === "completed" ? TEST_NOW : null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
}

const twoRows = [
  rec("ar_actor", ACTOR_ID, "completed"),
  rec("ar_target", TARGET_ID, "in_progress"),
];

describe("listTrackProgress", () => {
  it("gives a facilitator every row with the retry-count struggle signal", async () => {
    const countPartHistory = vi.fn(async () => 3);
    const { entries } = await listTrackProgress(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "participant" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => track("facilitator_only")),
          enrollment: vi.fn(async () => enrollment("facilitator")),
        }),
        policy: makePolicy(),
        records: makeRecords({ listByTrack: vi.fn(async () => twoRows), countPartHistory }),
      },
    );
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.retryCount === 3)).toBe(true);
    expect(countPartHistory).toHaveBeenCalledTimes(2);
  });

  it("gives a peer on a shared track every coarse row but no retry counts", async () => {
    const countPartHistory = vi.fn(async () => 3);
    const { entries } = await listTrackProgress(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "participant" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => track("shared")),
          enrollment: vi.fn(async () => enrollment("participant")),
        }),
        policy: makePolicy(),
        records: makeRecords({ listByTrack: vi.fn(async () => twoRows), countPartHistory }),
      },
    );
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.retryCount === null)).toBe(true);
    expect(countPartHistory).not.toHaveBeenCalled();
  });

  it("gives a peer on a facilitator_only track only their own row", async () => {
    const { entries } = await listTrackProgress(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "participant" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => track("facilitator_only")),
          enrollment: vi.fn(async () => enrollment("participant")),
        }),
        policy: makePolicy(),
        records: makeRecords({ listByTrack: vi.fn(async () => twoRows) }),
      },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.participantId).toBe(ACTOR_ID);
  });

  it("404s a non-member before any progress read (viewability before authorization)", async () => {
    const listByTrack = vi.fn(async () => twoRows);
    await expect(
      listTrackProgress(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
          tracks: makeTracks({ byId: vi.fn(async () => track("shared")) }),
          policy: makePolicy(),
          records: makeRecords({ listByTrack }),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(listByTrack).not.toHaveBeenCalled();
  });

  it("403s an in-group viewer who is neither enrolled nor an authority", async () => {
    const listByTrack = vi.fn(async () => twoRows);
    await expect(
      listTrackProgress(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          tracks: makeTracks({
            byId: vi.fn(async () => track("shared")),
            enrollment: vi.fn(async () => null),
          }),
          policy: makePolicy(),
          records: makeRecords({ listByTrack }),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_enrollee" });
    expect(listByTrack).not.toHaveBeenCalled();
  });
});
