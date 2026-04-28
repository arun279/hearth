import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import { canEnrollSelfInTrack } from "../src/policy/can-enroll-in-track.ts";
import { isAuthorityOverTrack } from "../src/policy/is-authority-over-track.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const uid = "u_actor" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;
const otherTid = "t_2" as LearningTrackId;
const otherGid = "g_2" as StudyGroupId;

const actor: User = {
  id: uid,
  email: "u@x.com",
  name: null,
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const activeTrack: LearningTrack = {
  id: tid,
  groupId: gid,
  name: "T",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const activeGroup: StudyGroup = {
  id: gid,
  name: "G",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const membership: GroupMembership = {
  groupId: gid,
  userId: uid,
  role: "participant",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
};

const enrollment: TrackEnrollment = {
  trackId: tid,
  userId: uid,
  role: "participant",
  enrolledAt: now,
  leftAt: null,
};

describe("canEnrollSelfInTrack", () => {
  it("allows a current member on an active track", () => {
    expect(canEnrollSelfInTrack(actor, activeTrack, activeGroup, membership).ok).toBe(true);
  });
  it("allows a current member on a paused track (the carve-out)", () => {
    expect(
      canEnrollSelfInTrack(actor, { ...activeTrack, status: "paused" }, activeGroup, membership).ok,
    ).toBe(true);
  });
  it("denies on an archived track", () => {
    const r = canEnrollSelfInTrack(
      actor,
      { ...activeTrack, status: "archived" },
      activeGroup,
      membership,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });
  it("denies when the parent group is archived", () => {
    const r = canEnrollSelfInTrack(
      actor,
      activeTrack,
      { ...activeGroup, status: "archived" },
      membership,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
  it("denies when membership is missing", () => {
    const r = canEnrollSelfInTrack(actor, activeTrack, activeGroup, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_a_member");
  });
  it("denies when membership is removed", () => {
    const r = canEnrollSelfInTrack(actor, activeTrack, activeGroup, {
      ...membership,
      removedAt: now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_a_member");
  });
});

describe("isAuthorityOverTrack", () => {
  it("true for an active group admin of the track's group", () => {
    expect(isAuthorityOverTrack(activeTrack, { ...membership, role: "admin" }, null)).toBe(true);
  });
  it("true for an active facilitator of the track", () => {
    expect(isAuthorityOverTrack(activeTrack, null, { ...enrollment, role: "facilitator" })).toBe(
      true,
    );
  });
  it("false when admin belongs to a different group", () => {
    expect(
      isAuthorityOverTrack(activeTrack, { ...membership, role: "admin", groupId: otherGid }, null),
    ).toBe(false);
  });
  it("false when facilitator belongs to a different track", () => {
    expect(
      isAuthorityOverTrack(activeTrack, null, {
        ...enrollment,
        role: "facilitator",
        trackId: otherTid,
      }),
    ).toBe(false);
  });
  it("false when admin membership is removed", () => {
    expect(
      isAuthorityOverTrack(activeTrack, { ...membership, role: "admin", removedAt: now }, null),
    ).toBe(false);
  });
  it("false when facilitator enrollment is left", () => {
    expect(
      isAuthorityOverTrack(activeTrack, null, {
        ...enrollment,
        role: "facilitator",
        leftAt: now,
      }),
    ).toBe(false);
  });
  it("false for a participant-only enrollment + non-admin membership", () => {
    expect(isAuthorityOverTrack(activeTrack, membership, enrollment)).toBe(false);
  });
  it("false when both inputs are null", () => {
    expect(isAuthorityOverTrack(activeTrack, null, null)).toBe(false);
  });
});
