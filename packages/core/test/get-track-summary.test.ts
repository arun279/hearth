import type { LearningTrack, LearningTrackId } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { getTrackSummary } from "../src/use-cases/get-track-summary.ts";
import {
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makePolicy,
  makeTracks,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const TRACK_ID = "t_1" as LearningTrackId;

const activeTrack: LearningTrack = {
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

describe("getTrackSummary", () => {
  it("returns counts populated from the port; non-M4 fields are 0", async () => {
    const countFacilitators = vi.fn(async () => 2);
    const countEnrollments = vi.fn(async () => 7);
    const result = await getTrackSummary(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          countFacilitators,
          countEnrollments,
        }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual({
      activityCount: 0,
      sessionCount: 0,
      libraryItemCount: 0,
      pendingContributionCount: 0,
      facilitatorCount: 2,
      enrollmentCount: 7,
    });
    expect(countFacilitators).toHaveBeenCalledWith(TRACK_ID);
    expect(countEnrollments).toHaveBeenCalledWith(TRACK_ID);
  });

  it("rejects NOT_FOUND/not_group_member for a non-member non-operator (no leak)", async () => {
    await expect(
      getTrackSummary(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_group_member" });
  });

  it("rejects NOT_FOUND when the track is missing", async () => {
    await expect(
      getTrackSummary(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => null) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
