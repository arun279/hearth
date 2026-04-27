import type { LearningTrack, LearningTrackId, TrackEnrollment } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { updateTrackMetadata } from "../src/use-cases/update-track-metadata.ts";
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
  name: "Old name",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const archivedTrack: LearningTrack = { ...activeTrack, status: "archived", archivedAt: TEST_NOW };

const facilitatorEnrollment: TrackEnrollment = {
  trackId: TRACK_ID,
  userId: ACTOR_ID,
  role: "facilitator",
  enrolledAt: TEST_NOW,
  leftAt: null,
};

describe("updateTrackMetadata", () => {
  it("admin updates name + description (trimmed)", async () => {
    const updated: LearningTrack = { ...activeTrack, name: "New", description: "Desc" };
    const updateMetadata = vi.fn(async () => updated);
    const result = await updateTrackMetadata(
      { actor: ACTOR_ID, trackId: TRACK_ID, name: "  New  ", description: "  Desc  " },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          updateMetadata,
        }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(updated);
    expect(updateMetadata).toHaveBeenCalledWith(
      TRACK_ID,
      { name: "New", description: "Desc" },
      ACTOR_ID,
    );
  });

  it("facilitator (non-admin) can update metadata", async () => {
    const updateMetadata = vi.fn(async () => activeTrack);
    await updateTrackMetadata(
      { actor: ACTOR_ID, trackId: TRACK_ID, name: "Renamed" },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => facilitatorEnrollment),
          updateMetadata,
        }),
        policy: makePolicy(),
      },
    );
    expect(updateMetadata).toHaveBeenCalledWith(TRACK_ID, { name: "Renamed" }, ACTOR_ID);
  });

  it("passes only the field that changed in the patch", async () => {
    const updateMetadata = vi.fn(async () => activeTrack);
    await updateTrackMetadata(
      { actor: ACTOR_ID, trackId: TRACK_ID, description: "new desc" },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          updateMetadata,
        }),
        policy: makePolicy(),
      },
    );
    expect(updateMetadata).toHaveBeenCalledWith(TRACK_ID, { description: "new desc" }, ACTOR_ID);
  });

  it("collapses an empty-string description to null (clear signal)", async () => {
    const updateMetadata = vi.fn(async () => activeTrack);
    await updateTrackMetadata(
      { actor: ACTOR_ID, trackId: TRACK_ID, description: "   " },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          updateMetadata,
        }),
        policy: makePolicy(),
      },
    );
    expect(updateMetadata).toHaveBeenCalledWith(TRACK_ID, { description: null }, ACTOR_ID);
  });

  it("rejects INVARIANT_VIOLATION/no_metadata_provided when neither field is given", async () => {
    await expect(
      updateTrackMetadata(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
      reason: "no_metadata_provided",
    });
  });

  it("rejects INVARIANT_VIOLATION/invalid_track_name on a too-long name", async () => {
    await expect(
      updateTrackMetadata(
        { actor: ACTOR_ID, trackId: TRACK_ID, name: "a".repeat(121) },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
      reason: "invalid_track_name",
    });
  });

  it("rejects FORBIDDEN/track_archived when the track is archived", async () => {
    await expect(
      updateTrackMetadata(
        { actor: ACTOR_ID, trackId: TRACK_ID, name: "New" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => archivedTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "track_archived" });
  });

  it("rejects NOT_FOUND when the track does not exist (no leak)", async () => {
    await expect(
      updateTrackMetadata(
        { actor: ACTOR_ID, trackId: TRACK_ID, name: "New" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => null) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects NOT_FOUND when the actor does not exist", async () => {
    await expect(
      updateTrackMetadata(
        { actor: ACTOR_ID, trackId: TRACK_ID, name: "New" },
        {
          users: makeUsers(),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects FORBIDDEN/not_track_authority for a participant non-facilitator", async () => {
    await expect(
      updateTrackMetadata(
        { actor: ACTOR_ID, trackId: TRACK_ID, name: "New" },
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
});
