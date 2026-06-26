import type { LearningTrack, LearningTrackId, PeerProgressVisibility } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { setPeerProgressVisibility } from "../src/use-cases/set-peer-progress-visibility.ts";
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
  peerProgressVisibility: "shared",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};
const archivedTrack: LearningTrack = { ...activeTrack, status: "archived", archivedAt: TEST_NOW };

const BOTH: readonly PeerProgressVisibility[] = ["shared", "facilitator_only"];

describe("setPeerProgressVisibility", () => {
  it.each(BOTH)("admin sets '%s' through to the repository unchanged", async (visibility) => {
    const saveFn = vi.fn(async () => ({ ...activeTrack, peerProgressVisibility: visibility }));
    await setPeerProgressVisibility(
      { actor: ACTOR_ID, trackId: TRACK_ID, visibility },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          savePeerProgressVisibility: saveFn,
        }),
        policy: makePolicy(),
      },
    );
    expect(saveFn).toHaveBeenCalledWith(TRACK_ID, visibility, ACTOR_ID);
  });

  it("rejects FORBIDDEN/track_archived when the track is archived", async () => {
    await expect(
      setPeerProgressVisibility(
        { actor: ACTOR_ID, trackId: TRACK_ID, visibility: "facilitator_only" },
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
      setPeerProgressVisibility(
        { actor: ACTOR_ID, trackId: TRACK_ID, visibility: "shared" },
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
      setPeerProgressVisibility(
        { actor: ACTOR_ID, trackId: TRACK_ID, visibility: "shared" },
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
