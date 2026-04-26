import type { LearningTrack, LearningTrackId } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { createTrack } from "../src/use-cases/create-track.ts";
import {
  ACTIVE_GROUP,
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

const created: LearningTrack = {
  id: TRACK_ID,
  groupId: GROUP_ID,
  name: "Track",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

describe("createTrack", () => {
  it("admin creates a track with trimmed name + description", async () => {
    const create = vi.fn(async () => created);
    const result = await createTrack(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        name: "  My Track  ",
        description: "  A description  ",
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ create }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(created);
    expect(create).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      name: "My Track",
      description: "A description",
      createdBy: ACTOR_ID,
    });
  });

  it("defaults description to null when omitted", async () => {
    const create = vi.fn(async () => created);
    await createTrack(
      { actor: ACTOR_ID, groupId: GROUP_ID, name: "Track" },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ create }),
        policy: makePolicy(),
      },
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
  });

  it("collapses an empty / whitespace-only description to null", async () => {
    const create = vi.fn(async () => created);
    await createTrack(
      { actor: ACTOR_ID, groupId: GROUP_ID, name: "Track", description: "   " },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({ create }),
        policy: makePolicy(),
      },
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
  });

  it("rejects FORBIDDEN/not_group_admin for a non-admin participant", async () => {
    await expect(
      createTrack(
        { actor: ACTOR_ID, groupId: GROUP_ID, name: "Track" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_group_admin" });
  });

  it("rejects FORBIDDEN/group_archived when the group is archived", async () => {
    await expect(
      createTrack(
        { actor: ACTOR_ID, groupId: GROUP_ID, name: "Track" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ARCHIVED_GROUP),
            membership: vi.fn(async () => membership({ role: "admin" })),
          }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "group_archived" });
  });

  it("rejects INVARIANT_VIOLATION/invalid_track_name on an empty name", async () => {
    await expect(
      createTrack(
        { actor: ACTOR_ID, groupId: GROUP_ID, name: "  " },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_track_name" });
  });

  it("rejects INVARIANT_VIOLATION on a name longer than 120 chars", async () => {
    await expect(
      createTrack(
        { actor: ACTOR_ID, groupId: GROUP_ID, name: "a".repeat(121) },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_track_name" });
  });

  it("rejects INVARIANT_VIOLATION on a description longer than 2000 chars", async () => {
    await expect(
      createTrack(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          name: "Track",
          description: "x".repeat(2001),
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
      reason: "invalid_track_description",
    });
  });

  it("rejects NOT_FOUND when the actor doesn't exist", async () => {
    await expect(
      createTrack(
        { actor: ACTOR_ID, groupId: GROUP_ID, name: "Track" },
        {
          users: makeUsers(),
          groups: makeGroups({ byId: vi.fn(async () => ACTIVE_GROUP) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects NOT_FOUND/not_group_member for a non-member non-operator (no existence leak)", async () => {
    await expect(
      createTrack(
        { actor: ACTOR_ID, groupId: GROUP_ID, name: "Track" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_group_member" });
  });
});
