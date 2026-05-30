import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type {
  ActivityRecordId,
  LearningActivityId,
  LearningTrackId,
  StudyGroupId,
  UserId,
} from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import { canMarkActivityComplete } from "../src/policy/can-mark-activity-complete.ts";
import { canMarkPartComplete } from "../src/policy/can-mark-part-complete.ts";
import { canOverrideActivityRecordVisibility } from "../src/policy/can-override-activity-record-visibility.ts";
import { canResetParticipantProgress } from "../src/policy/can-reset-participant-progress.ts";
import { canViewActivityRecord } from "../src/policy/can-view-activity-record.ts";
import type { ActivityRecord } from "../src/record/types.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-05-29T00:00:00.000Z");
const ownerId = "u_owner" as UserId;
const otherId = "u_other" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;

const owner: User = {
  id: ownerId,
  email: "owner@x.com",
  name: null,
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};
const other: User = { ...owner, id: otherId, email: "other@x.com" };

const record: ActivityRecord = {
  id: "ar_1" as ActivityRecordId,
  activityId: "a_1" as LearningActivityId,
  participantId: ownerId,
  completionState: "in_progress",
  completedAt: null,
  visibilityOverride: null,
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

const facilitatorEnrollment: TrackEnrollment = {
  trackId: tid,
  userId: otherId,
  role: "facilitator",
  enrolledAt: now,
  leftAt: null,
};
const operator: InstanceOperator = {
  userId: otherId,
  grantedAt: now,
  grantedBy: ownerId,
  revokedAt: null,
  revokedBy: null,
};

describe("canOverrideActivityRecordVisibility", () => {
  it("allows the participant", () => {
    expect(canOverrideActivityRecordVisibility(owner, record).ok).toBe(true);
  });
  it("denies anyone else", () => {
    const result = canOverrideActivityRecordVisibility(other, record);
    expect(result).toEqual({
      ok: false,
      reason: { code: "not_record_owner", message: expect.any(String) },
    });
  });
});

describe("canMarkPartComplete", () => {
  it("allows the participant when open and prerequisites are met", () => {
    expect(canMarkPartComplete(owner, record, "open", true).ok).toBe(true);
  });
  it("denies a non-owner", () => {
    expect(canMarkPartComplete(other, record, "open", true)).toMatchObject({
      ok: false,
      reason: { code: "not_record_owner" },
    });
  });
  it("denies when the activity is not open", () => {
    expect(canMarkPartComplete(owner, record, "locked", true)).toMatchObject({
      reason: { code: "activity_window_closed" },
    });
    expect(canMarkPartComplete(owner, record, "pre_open", true)).toMatchObject({
      reason: { code: "activity_window_closed" },
    });
  });
  it("denies when a hard prerequisite is unmet", () => {
    expect(canMarkPartComplete(owner, record, "open", false)).toMatchObject({
      reason: { code: "prereq_not_met" },
    });
  });
});

describe("canMarkActivityComplete", () => {
  it("allows manual completion when open", () => {
    expect(canMarkActivityComplete(owner, record, { kind: "manual_mark" }, "open", false).ok).toBe(
      true,
    );
  });
  it("blocks all_parts_complete until every Part is done", () => {
    expect(
      canMarkActivityComplete(owner, record, { kind: "all_parts_complete" }, "open", false),
    ).toMatchObject({ reason: { code: "parts_incomplete" } });
    expect(
      canMarkActivityComplete(owner, record, { kind: "all_parts_complete" }, "open", true).ok,
    ).toBe(true);
  });
  it("denies a non-owner and a closed activity", () => {
    expect(
      canMarkActivityComplete(other, record, { kind: "manual_mark" }, "open", false),
    ).toMatchObject({ reason: { code: "not_record_owner" } });
    expect(
      canMarkActivityComplete(owner, record, { kind: "manual_mark" }, "locked", false),
    ).toMatchObject({ reason: { code: "activity_window_closed" } });
  });
});

describe("canResetParticipantProgress", () => {
  it("allows a Track Facilitator", () => {
    expect(
      canResetParticipantProgress(other, activeGroup, activeTrack, null, facilitatorEnrollment).ok,
    ).toBe(true);
  });
  it("denies a participant without authority", () => {
    expect(canResetParticipantProgress(owner, activeGroup, activeTrack, null, null)).toMatchObject({
      reason: { code: "not_track_authority" },
    });
  });
  it("denies on an archived track", () => {
    expect(
      canResetParticipantProgress(other, activeGroup, archivedTrack, null, facilitatorEnrollment),
    ).toMatchObject({ reason: { code: "track_archived" } });
  });
});

describe("canViewActivityRecord", () => {
  it("gives the participant full detail", () => {
    expect(canViewActivityRecord(owner, record, activeTrack, null, null, null)).toEqual({
      ok: true,
      scope: "full",
    });
  });
  it("gives a Track Facilitator full detail", () => {
    expect(
      canViewActivityRecord(other, record, activeTrack, null, facilitatorEnrollment, null),
    ).toEqual({ ok: true, scope: "full" });
  });
  it("gives an Instance Operator full detail", () => {
    expect(canViewActivityRecord(other, record, activeTrack, null, null, operator)).toEqual({
      ok: true,
      scope: "full",
    });
  });
  it("denies a non-authority viewer (route returns 404)", () => {
    const membership: GroupMembership = {
      groupId: gid,
      userId: otherId,
      role: "participant",
      joinedAt: now,
      removedAt: null,
      removedBy: null,
      attributionOnLeave: null,
      displayNameSnapshot: null,
      profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
    };
    expect(canViewActivityRecord(other, record, activeTrack, membership, null, null)).toMatchObject(
      {
        ok: false,
        reason: { code: "not_record_owner" },
      },
    );
  });
});
