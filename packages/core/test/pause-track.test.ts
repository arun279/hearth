import type { LearningTrack, LearningTrackId } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { pauseTrack } from "../src/use-cases/pause-track.ts";
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
const pausedTrack: LearningTrack = { ...activeTrack, status: "paused", pausedAt: TEST_NOW };
const archivedTrack: LearningTrack = { ...activeTrack, status: "archived", archivedAt: TEST_NOW };

describe("pauseTrack", () => {
  it("flips active → paused via updateStatus({to:'paused', expectedFromStatus:'active'})", async () => {
    const updateStatus = vi.fn(async () => pausedTrack);
    const result = await pauseTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => activeTrack), updateStatus }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(pausedTrack);
    expect(updateStatus).toHaveBeenCalledWith({
      id: TRACK_ID,
      to: "paused",
      expectedFromStatus: "active",
      by: ACTOR_ID,
    });
  });

  it("is a no-op on an already-paused track (idempotent retry)", async () => {
    const updateStatus = vi.fn();
    const result = await pauseTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => pausedTrack), updateStatus }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(pausedTrack);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("rejects CONFLICT/track_status_transition_invalid for an archived track", async () => {
    await expect(
      pauseTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => archivedTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      reason: "track_status_transition_invalid",
    });
  });

  it("rejects FORBIDDEN/not_track_authority for a participant non-facilitator", async () => {
    await expect(
      pauseTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_authority" });
  });

  it("rejects NOT_FOUND when the track is missing (no existence leak)", async () => {
    await expect(
      pauseTrack(
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

  it("rejects NOT_FOUND when the actor doesn't exist", async () => {
    await expect(
      pauseTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
