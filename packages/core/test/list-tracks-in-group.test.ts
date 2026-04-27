import type { LearningTrack, LearningTrackId } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { listTracksInGroup } from "../src/use-cases/list-tracks-in-group.ts";
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

const trackOne: LearningTrack = {
  id: "t_1" as LearningTrackId,
  groupId: GROUP_ID,
  name: "Track One",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};
const trackTwo: LearningTrack = { ...trackOne, id: "t_2" as LearningTrackId, name: "Track Two" };

describe("listTracksInGroup", () => {
  it("returns the tracks the repository hands back for a current admin", async () => {
    const byGroup = vi.fn(async () => [trackOne, trackTwo]);
    const result = await listTracksInGroup(
      { actor: ACTOR_ID, groupId: GROUP_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ byGroup }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual([trackOne, trackTwo]);
    expect(byGroup).toHaveBeenCalledWith(GROUP_ID, undefined);
  });

  it("passes the status filter through to the repository", async () => {
    const byGroup = vi.fn(async () => [trackOne]);
    await listTracksInGroup(
      { actor: ACTOR_ID, groupId: GROUP_ID, status: "active" },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "participant" })) }),
        tracks: makeTracks({ byGroup }),
        policy: makePolicy(),
      },
    );
    expect(byGroup).toHaveBeenCalledWith(GROUP_ID, { status: "active" });
  });

  it("rejects NOT_FOUND/not_group_member for a non-member non-operator (no leak)", async () => {
    await expect(
      listTracksInGroup(
        { actor: ACTOR_ID, groupId: GROUP_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_group_member" });
  });

  it("rejects NOT_FOUND when the group is missing", async () => {
    await expect(
      listTracksInGroup(
        { actor: ACTOR_ID, groupId: GROUP_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ byId: vi.fn(async () => null) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects NOT_FOUND when the actor doesn't exist", async () => {
    await expect(
      listTracksInGroup(
        { actor: ACTOR_ID, groupId: GROUP_ID },
        {
          users: makeUsers(),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
