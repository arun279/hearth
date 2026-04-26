import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import { canArchiveTrack } from "../src/policy/can-archive-track.ts";
import { canEditContributionPolicy } from "../src/policy/can-edit-contribution-policy.ts";
import { canEditTrackMetadata } from "../src/policy/can-edit-track-metadata.ts";
import { canEditTrackStructure } from "../src/policy/can-edit-track-structure.ts";
import { canPauseTrack } from "../src/policy/can-pause-track.ts";
import { canResumeTrack } from "../src/policy/can-resume-track.ts";
import { canViewTrack } from "../src/policy/can-view-track.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const uid = "u_actor" as UserId;
const gid = "g_1" as StudyGroupId;
const otherGid = "g_2" as StudyGroupId;
const tid = "t_1" as LearningTrackId;

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

const archivedGroup: StudyGroup = { ...activeGroup, status: "archived", archivedAt: now };

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
const archivedTrack: LearningTrack = { ...activeTrack, status: "archived", archivedAt: now };

const adminMembership: GroupMembership = {
  groupId: gid,
  userId: uid,
  role: "admin",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
};

const participantMembership: GroupMembership = { ...adminMembership, role: "participant" };

const facilitatorEnrollment: TrackEnrollment = {
  trackId: tid,
  userId: uid,
  role: "facilitator",
  enrolledAt: now,
  leftAt: null,
};

const leftFacilitator: TrackEnrollment = { ...facilitatorEnrollment, leftAt: now };

const operator: InstanceOperator = {
  userId: uid,
  grantedAt: now,
  grantedBy: uid,
  revokedAt: null,
  revokedBy: null,
};

describe("canViewTrack", () => {
  it("allows an active operator regardless of membership", () => {
    expect(canViewTrack(actor, activeGroup, activeTrack, null, operator).ok).toBe(true);
  });

  it("allows a current group member (participant — no enrollment required)", () => {
    expect(canViewTrack(actor, activeGroup, activeTrack, participantMembership, null).ok).toBe(
      true,
    );
  });

  it("denies a non-member non-operator with not_group_member", () => {
    const r = canViewTrack(actor, activeGroup, activeTrack, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });

  it("denies when the track does not belong to the referenced group with track_not_in_group", () => {
    const otherGroup: StudyGroup = { ...activeGroup, id: otherGid };
    const r = canViewTrack(actor, otherGroup, activeTrack, adminMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_not_in_group");
  });

  it("denies a removed member", () => {
    const r = canViewTrack(
      actor,
      activeGroup,
      activeTrack,
      { ...participantMembership, removedAt: now },
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
});

// canArchiveTrack / canPauseTrack / canResumeTrack share the same authority
// shape — same allow/deny matrix less the track-archived gate (an archived
// track is still pause/resume/archive-no-op-able from the policy's view; the
// use case handles idempotence).
describe.each([
  { name: "canArchiveTrack", fn: canArchiveTrack },
  { name: "canPauseTrack", fn: canPauseTrack },
  { name: "canResumeTrack", fn: canResumeTrack },
])("$name (status-flip authority)", ({ fn }) => {
  it("denies on an archived parent group with group_archived", () => {
    const r = fn(actor, archivedGroup, activeTrack, adminMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });

  it("denies for a participant non-facilitator with not_track_authority", () => {
    const r = fn(actor, activeGroup, activeTrack, participantMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });

  it("denies a non-member non-enrollee with not_track_authority", () => {
    const r = fn(actor, activeGroup, activeTrack, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });

  it("allows an active group admin", () => {
    expect(fn(actor, activeGroup, activeTrack, adminMembership, null).ok).toBe(true);
  });

  it("allows an active facilitator (no admin membership)", () => {
    expect(
      fn(actor, activeGroup, activeTrack, participantMembership, facilitatorEnrollment).ok,
    ).toBe(true);
  });

  it("denies a left facilitator with not_track_authority", () => {
    const r = fn(actor, activeGroup, activeTrack, participantMembership, leftFacilitator);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
});

// canEditTrackMetadata / canEditTrackStructure / canEditContributionPolicy
// share the authority shape AND additionally deny on an archived track.
describe.each([
  { name: "canEditTrackMetadata", fn: canEditTrackMetadata },
  { name: "canEditTrackStructure", fn: canEditTrackStructure },
  { name: "canEditContributionPolicy", fn: canEditContributionPolicy },
])("$name (edit authority — track must not be archived)", ({ fn }) => {
  it("denies on an archived parent group with group_archived", () => {
    const r = fn(actor, archivedGroup, activeTrack, adminMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });

  it("denies on an archived track with track_archived", () => {
    const r = fn(actor, activeGroup, archivedTrack, adminMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });

  it("denies for a participant non-facilitator with not_track_authority", () => {
    const r = fn(actor, activeGroup, activeTrack, participantMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });

  it("allows an active group admin", () => {
    expect(fn(actor, activeGroup, activeTrack, adminMembership, null).ok).toBe(true);
  });

  it("allows an active facilitator on an active track", () => {
    expect(
      fn(actor, activeGroup, activeTrack, participantMembership, facilitatorEnrollment).ok,
    ).toBe(true);
  });

  it("allows an admin on a paused track (paused stays editable)", () => {
    const paused: LearningTrack = { ...activeTrack, status: "paused", pausedAt: now };
    expect(fn(actor, activeGroup, paused, adminMembership, null).ok).toBe(true);
  });

  it("denies a left facilitator with not_track_authority", () => {
    const r = fn(actor, activeGroup, activeTrack, participantMembership, leftFacilitator);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
});
