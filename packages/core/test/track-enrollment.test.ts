import type { LearningTrack, LearningTrackId, TrackEnrollment } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import {
  assignTrackFacilitator,
  removeTrackFacilitator,
} from "../src/use-cases/assign-track-facilitator.ts";
import { enrollInTrack } from "../src/use-cases/enroll-in-track.ts";
import { leaveTrack } from "../src/use-cases/leave-track.ts";
import { listTrackPeople } from "../src/use-cases/list-track-people.ts";
import { removeTrackEnrollment } from "../src/use-cases/remove-track-enrollment.ts";
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
  TARGET,
  TARGET_ID,
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

const enrollmentOf = (
  userId: typeof ACTOR_ID,
  role: "participant" | "facilitator" = "participant",
): TrackEnrollment => ({
  trackId: TRACK_ID,
  userId,
  role,
  enrolledAt: TEST_NOW,
  leftAt: null,
});

describe("enrollInTrack", () => {
  it("self-enrolls a current member", async () => {
    const enroll = vi.fn(async () => enrollmentOf(ACTOR_ID));
    const result = await enrollInTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enroll,
        }),
        policy: makePolicy(),
      },
    );
    expect(result.userId).toBe(ACTOR_ID);
    expect(enroll).toHaveBeenCalledWith({
      trackId: TRACK_ID,
      userId: ACTOR_ID,
      by: ACTOR_ID,
    });
  });

  it("rejects with NOT_FOUND when actor isn't a current group member (visibility hides existence)", async () => {
    // The visibility gate fires first — `loadViewableTrack` can't reach
    // the enrollment policy because the track is not visible to a
    // non-member. The NOT_FOUND projection prevents the 403/404 split
    // from leaking existence to a probing non-member.
    await expect(
      enrollInTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => null),
          }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_group_member" });
  });

  it("authority enroll: admin enrolls a current member", async () => {
    const enroll = vi.fn(async () => enrollmentOf(TARGET_ID));
    const result = await enrollInTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID, targetUserId: TARGET_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async (_g, uid) =>
            uid === ACTOR_ID
              ? membership({ role: "admin" })
              : membership({ userId: TARGET_ID, role: "participant" }),
          ),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enroll,
        }),
        policy: makePolicy(),
      },
    );
    expect(result.userId).toBe(TARGET_ID);
    expect(enroll).toHaveBeenCalledWith({
      trackId: TRACK_ID,
      userId: TARGET_ID,
      by: ACTOR_ID,
    });
  });

  it("authority enroll: rejects when target is not a current group member", async () => {
    await expect(
      enrollInTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID, targetUserId: TARGET_ID },
        {
          users: makeUsers(ACTOR, TARGET),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async (_g, uid) =>
              uid === ACTOR_ID ? membership({ role: "admin" }) : null,
            ),
          }),
          tracks: makeTracks({ byId: vi.fn(async () => activeTrack) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "enrollment_requires_membership" });
  });
});

describe("leaveTrack", () => {
  it("denies when actor is the last facilitator on an active track", async () => {
    await expect(
      leaveTrack(
        { actor: ACTOR_ID, trackId: TRACK_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          tracks: makeTracks({
            byId: vi.fn(async () => activeTrack),
            enrollment: vi.fn(async () => enrollmentOf(ACTOR_ID, "facilitator")),
            countFacilitators: vi.fn(async () => 1),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_facilitator" });
  });

  it("calls unenroll for self when count > 1", async () => {
    const unenroll = vi.fn(async () => ({
      ...enrollmentOf(ACTOR_ID),
      leftAt: TEST_NOW,
    }));
    await leaveTrack(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => enrollmentOf(ACTOR_ID, "facilitator")),
          countFacilitators: vi.fn(async () => 2),
          unenroll,
        }),
        policy: makePolicy(),
      },
    );
    expect(unenroll).toHaveBeenCalledWith({
      trackId: TRACK_ID,
      userId: ACTOR_ID,
      by: ACTOR_ID,
    });
  });
});

describe("removeTrackEnrollment", () => {
  it("rejects self-target — deflects to leaveTrack", async () => {
    await expect(
      removeTrackEnrollment(
        { actor: ACTOR_ID, trackId: TRACK_ID, target: ACTOR_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups(),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "self_remove_via_leave" });
  });

  it("admin removes a participant target", async () => {
    const unenroll = vi.fn(async () => ({
      ...enrollmentOf(TARGET_ID),
      leftAt: TEST_NOW,
    }));
    await removeTrackEnrollment(
      { actor: ACTOR_ID, trackId: TRACK_ID, target: TARGET_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "admin" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async (_t, uid) =>
            uid === ACTOR_ID ? enrollmentOf(ACTOR_ID, "facilitator") : enrollmentOf(TARGET_ID),
          ),
          countFacilitators: vi.fn(async () => 1),
          unenroll,
        }),
        policy: makePolicy(),
      },
    );
    expect(unenroll).toHaveBeenCalledWith({
      trackId: TRACK_ID,
      userId: TARGET_ID,
      by: ACTOR_ID,
    });
  });
});

describe("assignTrackFacilitator / removeTrackFacilitator", () => {
  it("assignTrackFacilitator: rejects when target has no current enrollment", async () => {
    await expect(
      assignTrackFacilitator(
        { actor: ACTOR_ID, trackId: TRACK_ID, target: TARGET_ID },
        {
          users: makeUsers(ACTOR, TARGET),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "admin" })),
          }),
          tracks: makeTracks({
            byId: vi.fn(async () => activeTrack),
            enrollment: vi.fn(async () => null),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_enrollee" });
  });

  it("removeTrackFacilitator: would_orphan_facilitator when count = 1 on active", async () => {
    await expect(
      removeTrackFacilitator(
        { actor: ACTOR_ID, trackId: TRACK_ID, target: TARGET_ID },
        {
          users: makeUsers(ACTOR, TARGET),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "admin" })),
          }),
          tracks: makeTracks({
            byId: vi.fn(async () => activeTrack),
            enrollment: vi.fn(async (_t, uid) =>
              uid === ACTOR_ID
                ? enrollmentOf(ACTOR_ID, "facilitator")
                : enrollmentOf(TARGET_ID, "facilitator"),
            ),
            countFacilitators: vi.fn(async () => 1),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_facilitator" });
  });
});

describe("listTrackPeople", () => {
  it("projects display names + per-row caps", async () => {
    const result = await listTrackPeople(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "admin" })),
        }),
        tracks: makeTracks({
          byId: vi.fn(async () => activeTrack),
          enrollment: vi.fn(async () => enrollmentOf(ACTOR_ID, "facilitator")),
          listEnrollments: vi.fn(async () => [
            enrollmentOf(ACTOR_ID, "facilitator"),
            enrollmentOf(TARGET_ID, "participant"),
          ]),
          countFacilitators: vi.fn(async () => 2),
        }),
        policy: makePolicy(),
      },
    );

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.displayName).toBe("Actor");
    expect(result.entries[1]?.displayName).toBe("Target");
    // Admin actor → can promote a participant.
    expect(result.entries[1]?.capabilities.canPromote).toBe(true);
    // Two facilitators → can demote either without orphaning.
    expect(result.entries[0]?.capabilities.canDemote).toBe(true);
    // Non-authority view scopes leftEntries to empty (here we are admin →
    // includeLeft was true; the test fake returns no left rows so
    // leftEntries is empty regardless).
    expect(result.leftEntries).toEqual([]);
  });
});
