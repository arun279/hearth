import type {
  LearningActivityId,
  LearningTrack,
  LearningTrackId,
  TrackStructureEnvelope,
} from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { saveTrackStructure } from "../src/use-cases/save-track-structure.ts";
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
const archivedTrack: LearningTrack = { ...activeTrack, status: "archived", archivedAt: TEST_NOW };

const freeEnvelope: TrackStructureEnvelope = { v: 1, data: { mode: "free" } };
const orderedEnvelope: TrackStructureEnvelope = {
  v: 1,
  data: {
    mode: "ordered_sections",
    sections: [
      {
        id: "s1",
        title: "Section 1",
        activityIds: ["a_1" as LearningActivityId],
      },
      { id: "s2", title: "Section 2", activityIds: [] },
    ],
  },
};

describe("saveTrackStructure", () => {
  it("admin saves a 'free' envelope through to the repository unchanged", async () => {
    const saveStructure = vi.fn(async () => activeTrack);
    await saveTrackStructure(
      { actor: ACTOR_ID, trackId: TRACK_ID, envelope: freeEnvelope },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => activeTrack), saveStructure }),
        policy: makePolicy(),
      },
    );
    expect(saveStructure).toHaveBeenCalledWith(TRACK_ID, freeEnvelope, ACTOR_ID);
  });

  it("admin saves an 'ordered_sections' envelope through unchanged", async () => {
    const saveStructure = vi.fn(async () => activeTrack);
    await saveTrackStructure(
      { actor: ACTOR_ID, trackId: TRACK_ID, envelope: orderedEnvelope },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byId: vi.fn(async () => activeTrack), saveStructure }),
        policy: makePolicy(),
      },
    );
    expect(saveStructure).toHaveBeenCalledWith(TRACK_ID, orderedEnvelope, ACTOR_ID);
  });

  it("rejects FORBIDDEN/track_archived when the track is archived", async () => {
    await expect(
      saveTrackStructure(
        { actor: ACTOR_ID, trackId: TRACK_ID, envelope: freeEnvelope },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks({ byId: vi.fn(async () => archivedTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "track_archived" });
  });

  it("rejects FORBIDDEN/not_track_authority for a participant non-facilitator", async () => {
    await expect(
      saveTrackStructure(
        { actor: ACTOR_ID, trackId: TRACK_ID, envelope: freeEnvelope },
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

  it("rejects NOT_FOUND when the track is missing", async () => {
    await expect(
      saveTrackStructure(
        { actor: ACTOR_ID, trackId: TRACK_ID, envelope: freeEnvelope },
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
