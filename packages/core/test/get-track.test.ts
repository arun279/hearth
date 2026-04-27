import type {
  ContributionPolicyEnvelope,
  LearningTrack,
  LearningTrackId,
  TrackEnrollment,
  TrackStructureEnvelope,
} from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { getTrack } from "../src/use-cases/get-track.ts";
import {
  ACTIVE_GROUP,
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
const pausedTrack: LearningTrack = { ...activeTrack, status: "paused", pausedAt: TEST_NOW };

const facilitatorEnrollment: TrackEnrollment = {
  trackId: TRACK_ID,
  userId: ACTOR_ID,
  role: "facilitator",
  enrolledAt: TEST_NOW,
  leftAt: null,
};

const structure: TrackStructureEnvelope = { v: 1, data: { mode: "free" } };
const contributionPolicy: ContributionPolicyEnvelope = { v: 1, data: { mode: "direct" } };

describe("getTrack", () => {
  it("returns track + group + structure + contributionPolicy + admin caps for an admin", async () => {
    const result = await getTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          loadStructure: vi.fn(async () => structure),
          loadContributionPolicy: vi.fn(async () => contributionPolicy),
        }),
        policy: makePolicy(),
      },
    );
    expect(result.track).toEqual(activeTrack);
    expect(result.group).toEqual({
      id: ACTIVE_GROUP.id,
      name: ACTIVE_GROUP.name,
      status: ACTIVE_GROUP.status,
    });
    expect(result.structure).toEqual(structure);
    expect(result.contributionPolicy).toEqual(contributionPolicy);
    expect(result.caps).toEqual({
      canEditMetadata: true,
      canEditStructure: true,
      canEditContributionPolicy: true,
      canPause: true,
      canResume: true,
      canArchive: true,
    });
  });

  it("returns all-false caps for a participant non-facilitator (still viewable)", async () => {
    const result = await getTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          loadStructure: vi.fn(async () => structure),
          loadContributionPolicy: vi.fn(async () => contributionPolicy),
        }),
        policy: makePolicy(),
      },
    );
    expect(result.myEnrollment).toBeNull();
    expect(result.caps.canEditMetadata).toBe(false);
    expect(result.caps.canPause).toBe(false);
    expect(result.caps.canArchive).toBe(false);
  });

  it("reflects facilitator authority in caps", async () => {
    const result = await getTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => facilitatorEnrollment),
          loadStructure: vi.fn(async () => structure),
          loadContributionPolicy: vi.fn(async () => contributionPolicy),
        }),
        policy: makePolicy(),
      },
    );
    expect(result.myEnrollment).toEqual(facilitatorEnrollment);
    expect(result.caps).toEqual({
      canEditMetadata: true,
      canEditStructure: true,
      canEditContributionPolicy: true,
      canPause: true,
      canResume: true,
      canArchive: true,
    });
  });

  it("returns canEdit*=false but canPause/canArchive=true on a paused admin view (paused stays editable)", async () => {
    const result = await getTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => pausedTrack),
          loadStructure: vi.fn(async () => structure),
          loadContributionPolicy: vi.fn(async () => contributionPolicy),
        }),
        policy: makePolicy(),
      },
    );
    expect(result.caps.canEditMetadata).toBe(true);
    expect(result.caps.canEditStructure).toBe(true);
    expect(result.caps.canPause).toBe(true);
    expect(result.caps.canResume).toBe(true);
    expect(result.caps.canArchive).toBe(true);
  });

  it("returns canEdit*=false on archived for admin (track-archived gate)", async () => {
    const result = await getTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => archivedTrack),
          loadStructure: vi.fn(async () => structure),
          loadContributionPolicy: vi.fn(async () => contributionPolicy),
        }),
        policy: makePolicy(),
      },
    );
    expect(result.caps.canEditMetadata).toBe(false);
    expect(result.caps.canEditStructure).toBe(false);
    expect(result.caps.canEditContributionPolicy).toBe(false);
  });

  it("rejects NOT_FOUND/not_group_member for a non-member non-operator (no leak)", async () => {
    await expect(
      getTrack(
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
      getTrack(
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
