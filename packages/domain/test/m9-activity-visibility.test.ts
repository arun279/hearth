import { describe, expect, it } from "vitest";
import type { ActivityAudience } from "../src/activity/types.ts";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import { canSeeActivity } from "../src/policy/can-see-activity.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-05-18T00:00:00.000Z");
const uid = "u_actor" as UserId;
const otherUid = "u_other" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;

const actor: User = {
  id: uid,
  email: "u@x.com",
  name: null,
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  visibilityPreference: "default",
  createdAt: now,
  updatedAt: now,
};

const group: StudyGroup = {
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

const track: LearningTrack = {
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

const participantMembership: GroupMembership = {
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
const adminMembership: GroupMembership = { ...participantMembership, role: "admin" };
const removedMembership: GroupMembership = { ...participantMembership, removedAt: now };

const facilitatorEnrollment: TrackEnrollment = {
  trackId: tid,
  userId: uid,
  role: "facilitator",
  enrolledAt: now,
  leftAt: null,
};

const activeOperator: InstanceOperator = {
  userId: uid,
  grantedAt: now,
  grantedBy: uid,
  revokedAt: null,
  revokedBy: null,
};

const audienceEveryone: ActivityAudience = { kind: "everyone_enrolled" };
const audienceSubsetIncludesActor: ActivityAudience = {
  kind: "subset",
  userIds: [uid, otherUid],
};
const audienceSubsetExcludesActor: ActivityAudience = {
  kind: "subset",
  userIds: [otherUid],
};

describe("canSeeActivity — visibility gate", () => {
  it("allows an active instance operator regardless of membership", () => {
    const r = canSeeActivity(
      actor,
      group,
      track,
      audienceSubsetExcludesActor,
      null,
      null,
      activeOperator,
    );
    expect(r.ok).toBe(true);
  });

  it("allows track authority even when the audience is narrowed", () => {
    const r = canSeeActivity(
      actor,
      group,
      track,
      audienceSubsetExcludesActor,
      participantMembership,
      facilitatorEnrollment,
      null,
    );
    expect(r.ok).toBe(true);
  });

  it("allows a group admin even when narrowed", () => {
    const r = canSeeActivity(
      actor,
      group,
      track,
      audienceSubsetExcludesActor,
      adminMembership,
      null,
      null,
    );
    expect(r.ok).toBe(true);
  });

  it("denies a non-member of the group", () => {
    const r = canSeeActivity(actor, group, track, audienceEveryone, null, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });

  it("denies a removed member", () => {
    const r = canSeeActivity(actor, group, track, audienceEveryone, removedMembership, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });

  it("allows a current member when audience is everyone_enrolled", () => {
    const r = canSeeActivity(
      actor,
      group,
      track,
      audienceEveryone,
      participantMembership,
      null,
      null,
    );
    expect(r.ok).toBe(true);
  });

  it("allows a current member listed in a subset audience", () => {
    const r = canSeeActivity(
      actor,
      group,
      track,
      audienceSubsetIncludesActor,
      participantMembership,
      null,
      null,
    );
    expect(r.ok).toBe(true);
  });

  it("denies 'not_in_audience' for a member excluded from a subset", () => {
    const r = canSeeActivity(
      actor,
      group,
      track,
      audienceSubsetExcludesActor,
      participantMembership,
      null,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_in_audience");
  });

  it("revoked operator falls through to membership rules", () => {
    const revokedOperator: InstanceOperator = { ...activeOperator, revokedAt: now };
    const r = canSeeActivity(actor, group, track, audienceEveryone, null, null, revokedOperator);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
});
