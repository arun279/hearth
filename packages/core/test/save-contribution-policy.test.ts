import type {
  ContributionMode,
  ContributionPolicyEnvelope,
  LearningTrack,
  LearningTrackId,
} from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { saveContributionPolicy } from "../src/use-cases/save-contribution-policy.ts";
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

const ALL_MODES: readonly ContributionMode[] = [
  "direct",
  "optional_review",
  "required_review",
  "none",
];

describe("saveContributionPolicy", () => {
  it.each(ALL_MODES)("admin saves the '%s' mode envelope through unchanged", async (mode) => {
    const envelope: ContributionPolicyEnvelope = { v: 1, data: { mode } };
    const saveContributionPolicyFn = vi.fn(async () => activeTrack);
    await saveContributionPolicy(
      { actor: ACTOR_ID, trackId: TRACK_ID, envelope },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          saveContributionPolicy: saveContributionPolicyFn,
        }),
        policy: makePolicy(),
      },
    );
    expect(saveContributionPolicyFn).toHaveBeenCalledWith(TRACK_ID, envelope, ACTOR_ID);
  });

  it("rejects FORBIDDEN/track_archived when the track is archived", async () => {
    await expect(
      saveContributionPolicy(
        {
          actor: ACTOR_ID,
          trackId: TRACK_ID,
          envelope: { v: 1, data: { mode: "direct" } },
        },
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
      saveContributionPolicy(
        {
          actor: ACTOR_ID,
          trackId: TRACK_ID,
          envelope: { v: 1, data: { mode: "direct" } },
        },
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
      saveContributionPolicy(
        {
          actor: ACTOR_ID,
          trackId: TRACK_ID,
          envelope: { v: 1, data: { mode: "direct" } },
        },
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
