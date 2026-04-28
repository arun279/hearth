import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import { canAssignTrackFacilitator } from "../src/policy/can-assign-track-facilitator.ts";
import { canEnrollUserInTrack } from "../src/policy/can-enroll-in-track.ts";
import { canLeaveTrack } from "../src/policy/can-leave-track.ts";
import { canRemoveTrackEnrollment } from "../src/policy/can-remove-track-enrollment.ts";
import { canRemoveTrackFacilitator } from "../src/policy/can-remove-track-facilitator.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import { wouldOrphanFacilitator } from "../src/track-invariants.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const aid = "u_actor" as UserId;
const tid = "t_1" as LearningTrackId;
const gid = "g_1" as StudyGroupId;

const actor: User = {
  id: aid,
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

const memberOf = (uid: UserId, role: "admin" | "participant" = "participant"): GroupMembership => ({
  groupId: gid,
  userId: uid,
  role,
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
});

const enrolledAs = (
  uid: UserId,
  role: "facilitator" | "participant" = "participant",
): TrackEnrollment => ({
  trackId: tid,
  userId: uid,
  role,
  enrolledAt: now,
  leftAt: null,
});

describe("wouldOrphanFacilitator", () => {
  it("true when the only facilitator on an active track is the target", () => {
    expect(wouldOrphanFacilitator(activeTrack, enrolledAs(aid, "facilitator"), 1)).toBe(true);
  });
  it("false when there are at least two facilitators", () => {
    expect(wouldOrphanFacilitator(activeTrack, enrolledAs(aid, "facilitator"), 2)).toBe(false);
  });
  it("false when target is a participant", () => {
    expect(wouldOrphanFacilitator(activeTrack, enrolledAs(aid, "participant"), 1)).toBe(false);
  });
  it("false when target has already left", () => {
    expect(
      wouldOrphanFacilitator(activeTrack, { ...enrolledAs(aid, "facilitator"), leftAt: now }, 1),
    ).toBe(false);
  });
  it("false when track is paused (frozen — orphan invariant doesn't apply)", () => {
    expect(
      wouldOrphanFacilitator(
        { ...activeTrack, status: "paused" },
        enrolledAs(aid, "facilitator"),
        1,
      ),
    ).toBe(false);
  });
  it("false when track is archived", () => {
    expect(
      wouldOrphanFacilitator(
        { ...activeTrack, status: "archived" },
        enrolledAs(aid, "facilitator"),
        1,
      ),
    ).toBe(false);
  });
  it("false when target enrollment is on a different track", () => {
    expect(
      wouldOrphanFacilitator(
        activeTrack,
        { ...enrolledAs(aid, "facilitator"), trackId: "t_other" as LearningTrackId },
        1,
      ),
    ).toBe(false);
  });
});

describe("canEnrollUserInTrack", () => {
  it("allows enrolling onto a paused track (carve-out)", () => {
    const r = canEnrollUserInTrack(
      actor,
      { ...activeTrack, status: "paused" },
      activeGroup,
      memberOf(aid, "admin"),
      null,
      memberOf("u_target" as UserId),
    );
    expect(r.ok).toBe(true);
  });
  it("allows a group admin to enroll a current member", () => {
    const r = canEnrollUserInTrack(
      actor,
      activeTrack,
      activeGroup,
      memberOf(aid, "admin"),
      null,
      memberOf("u_target" as UserId),
    );
    expect(r.ok).toBe(true);
  });
  it("allows a track facilitator to enroll a current member", () => {
    const r = canEnrollUserInTrack(
      actor,
      activeTrack,
      activeGroup,
      memberOf(aid),
      enrolledAs(aid, "facilitator"),
      memberOf("u_target" as UserId),
    );
    expect(r.ok).toBe(true);
  });
  it("denies non-authority", () => {
    const r = canEnrollUserInTrack(
      actor,
      activeTrack,
      activeGroup,
      memberOf(aid),
      null,
      memberOf("u_target" as UserId),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
  it("denies when the target is not a current group member", () => {
    const r = canEnrollUserInTrack(
      actor,
      activeTrack,
      activeGroup,
      memberOf(aid, "admin"),
      null,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("enrollment_requires_membership");
  });
  it("denies on archived tracks", () => {
    const r = canEnrollUserInTrack(
      actor,
      { ...activeTrack, status: "archived" },
      activeGroup,
      memberOf(aid, "admin"),
      null,
      memberOf("u_target" as UserId),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });
  it("denies when group is archived", () => {
    const r = canEnrollUserInTrack(
      actor,
      activeTrack,
      { ...activeGroup, status: "archived" },
      memberOf(aid, "admin"),
      null,
      memberOf("u_target" as UserId),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
});

describe("canLeaveTrack", () => {
  it("allows leaving when not the last facilitator", () => {
    const r = canLeaveTrack(
      activeGroup,
      activeTrack,
      memberOf(aid),
      enrolledAs(aid, "facilitator"),
      2,
    );
    expect(r.ok).toBe(true);
  });
  it("denies when actor is not a current member", () => {
    const r = canLeaveTrack(activeGroup, activeTrack, null, enrolledAs(aid), 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_a_member");
  });
  it("denies when actor is the last facilitator on an active track", () => {
    const r = canLeaveTrack(
      activeGroup,
      activeTrack,
      memberOf(aid),
      enrolledAs(aid, "facilitator"),
      1,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("would_orphan_facilitator");
  });
  it("allows last facilitator to leave a paused track", () => {
    const r = canLeaveTrack(
      activeGroup,
      { ...activeTrack, status: "paused" },
      memberOf(aid),
      enrolledAs(aid, "facilitator"),
      1,
    );
    expect(r.ok).toBe(true);
  });
  it("denies when actor has no current enrollment", () => {
    const r = canLeaveTrack(activeGroup, activeTrack, memberOf(aid), null, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_enrollee");
  });
  it("denies when group is archived", () => {
    const r = canLeaveTrack(
      { ...activeGroup, status: "archived" },
      activeTrack,
      memberOf(aid),
      enrolledAs(aid),
      1,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
});

describe("canRemoveTrackEnrollment", () => {
  const target = "u_target" as UserId;
  it("allows authority to remove a participant", () => {
    const r = canRemoveTrackEnrollment(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target),
      2,
    );
    expect(r.ok).toBe(true);
  });
  it("denies removing the last facilitator on an active track", () => {
    const r = canRemoveTrackEnrollment(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "facilitator"),
      1,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("would_orphan_facilitator");
  });
  it("allows removing the last facilitator on a paused track", () => {
    const r = canRemoveTrackEnrollment(
      activeGroup,
      { ...activeTrack, status: "paused" },
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "facilitator"),
      1,
    );
    expect(r.ok).toBe(true);
  });
  it("denies non-authority", () => {
    const r = canRemoveTrackEnrollment(
      activeGroup,
      activeTrack,
      memberOf(aid),
      null,
      enrolledAs(target),
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
  it("denies when target already left", () => {
    const r = canRemoveTrackEnrollment(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      { ...enrolledAs(target), leftAt: now },
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_enrollee");
  });
  it("denies when group is archived", () => {
    const r = canRemoveTrackEnrollment(
      { ...activeGroup, status: "archived" },
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target),
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
});

describe("canAssignTrackFacilitator", () => {
  const target = "u_target" as UserId;
  it("allows authority to promote a current participant", () => {
    const r = canAssignTrackFacilitator(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "participant"),
    );
    expect(r.ok).toBe(true);
  });
  it("denies if target has no current enrollment", () => {
    const r = canAssignTrackFacilitator(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_enrollee");
  });
  it("denies on archived tracks", () => {
    const r = canAssignTrackFacilitator(
      activeGroup,
      { ...activeTrack, status: "archived" },
      memberOf(aid, "admin"),
      null,
      enrolledAs(target),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });
  it("denies non-authority", () => {
    const r = canAssignTrackFacilitator(
      activeGroup,
      activeTrack,
      memberOf(aid),
      null,
      enrolledAs(target),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
  it("denies when group is archived", () => {
    const r = canAssignTrackFacilitator(
      { ...activeGroup, status: "archived" },
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
});

describe("canRemoveTrackFacilitator", () => {
  const target = "u_target" as UserId;
  it("allows authority to demote when count > 1", () => {
    const r = canRemoveTrackFacilitator(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "facilitator"),
      2,
    );
    expect(r.ok).toBe(true);
  });
  it("denies demoting the last facilitator on an active track", () => {
    const r = canRemoveTrackFacilitator(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "facilitator"),
      1,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("would_orphan_facilitator");
  });
  it("allows demoting the last facilitator on a paused track", () => {
    const r = canRemoveTrackFacilitator(
      activeGroup,
      { ...activeTrack, status: "paused" },
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "facilitator"),
      1,
    );
    expect(r.ok).toBe(true);
  });
  it("denies if target is not a current facilitator", () => {
    const r = canRemoveTrackFacilitator(
      activeGroup,
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "participant"),
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_facilitator");
  });
  it("denies non-authority", () => {
    const r = canRemoveTrackFacilitator(
      activeGroup,
      activeTrack,
      memberOf(aid),
      null,
      enrolledAs(target, "facilitator"),
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
  it("denies when group is archived", () => {
    const r = canRemoveTrackFacilitator(
      { ...activeGroup, status: "archived" },
      activeTrack,
      memberOf(aid, "admin"),
      null,
      enrolledAs(target, "facilitator"),
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
});
