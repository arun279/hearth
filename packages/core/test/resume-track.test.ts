import type { LearningTrack, LearningTrackId } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { resumeTrack } from "../src/use-cases/resume-track.ts";
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

describe("resumeTrack", () => {
  it("flips paused → active via updateStatus({to:'active', expectedFromStatus:'paused'})", async () => {
    const updateStatus = vi.fn(async () => activeTrack);
    const result = await resumeTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => pausedTrack), updateStatus }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(activeTrack);
    expect(updateStatus).toHaveBeenCalledWith({
      id: TRACK_ID,
      to: "active",
      expectedFromStatus: "paused",
      by: ACTOR_ID,
    });
  });

  it("is a no-op on an already-active track (idempotent retry)", async () => {
    const updateStatus = vi.fn();
    const result = await resumeTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => activeTrack), updateStatus }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(activeTrack);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("rejects FORBIDDEN/track_archived for an archived track (policy-level deny)", async () => {
    await expect(
      resumeTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => archivedTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      reason: "track_archived",
    });
  });

  it("rejects FORBIDDEN/not_track_authority for a participant non-facilitator", async () => {
    await expect(
      resumeTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          tracks: makeTracks({ byId: vi.fn(async () => pausedTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_authority" });
  });

  it("rejects NOT_FOUND when the track is missing", async () => {
    await expect(
      resumeTrack(
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
