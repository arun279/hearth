import type { LearningTrack, LearningTrackId, TrackEnrollment } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { archiveTrack } from "../src/use-cases/archive-track.ts";
import {
  ACTOR,
  ACTOR_ID,
  ARCHIVED_GROUP,
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
const archivedTrack: LearningTrack = {
  ...activeTrack,
  status: "archived",
  archivedAt: TEST_NOW,
  archivedBy: ACTOR_ID,
};

const facilitatorEnrollment: TrackEnrollment = {
  trackId: TRACK_ID,
  userId: ACTOR_ID,
  role: "facilitator",
  enrolledAt: TEST_NOW,
  leftAt: null,
};

describe("archiveTrack", () => {
  it("archives an active track via updateStatus({to:'archived', expectedFromStatus:'active'})", async () => {
    const updateStatus = vi.fn(async () => archivedTrack);
    await archiveTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => activeTrack), updateStatus }),
        policy: makePolicy(),
      },
    );
    expect(updateStatus).toHaveBeenCalledWith({
      id: TRACK_ID,
      to: "archived",
      expectedFromStatus: "active",
      by: ACTOR_ID,
    });
  });

  it("archives a paused track via updateStatus({to:'archived', expectedFromStatus:'paused'})", async () => {
    const updateStatus = vi.fn(async () => archivedTrack);
    await archiveTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => pausedTrack), updateStatus }),
        policy: makePolicy(),
      },
    );
    expect(updateStatus).toHaveBeenCalledWith({
      id: TRACK_ID,
      to: "archived",
      expectedFromStatus: "paused",
      by: ACTOR_ID,
    });
  });

  it("is a no-op on an already-archived track (idempotent retry)", async () => {
    const updateStatus = vi.fn();
    const result = await archiveTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => archivedTrack), updateStatus }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(archivedTrack);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("allows a facilitator (not group admin) to archive", async () => {
    const updateStatus = vi.fn(async () => archivedTrack);
    await archiveTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => facilitatorEnrollment),
          updateStatus,
        }),
        policy: makePolicy(),
      },
    );
    expect(updateStatus).toHaveBeenCalled();
  });

  it("rejects FORBIDDEN/not_track_authority for a participant non-facilitator", async () => {
    await expect(
      archiveTrack(
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

  it("rejects FORBIDDEN/group_archived when the parent group is archived", async () => {
    await expect(
      archiveTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ARCHIVED_GROUP),
            membership: vi.fn(async () => membership({ role: "admin" })),
          }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "group_archived" });
  });

  it("rejects NOT_FOUND when the track is missing (no existence leak)", async () => {
    await expect(
      archiveTrack(
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
