import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import {
  isActiveOperator,
  isCurrentEnrollment,
  isCurrentMember,
  isWritable,
} from "../src/policy/helpers.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import type { User } from "../src/user.ts";

const gid = "g_1" as StudyGroupId;
const otherGid = "g_2" as StudyGroupId;
const tid = "t_1" as LearningTrackId;
const otherTid = "t_2" as LearningTrackId;
const uid = "u_1" as UserId;
const otherUid = "u_2" as UserId;

const now = new Date("2026-04-22T00:00:00.000Z");

const membership = (over: Partial<GroupMembership> = {}): GroupMembership => ({
  groupId: gid,
  userId: uid,
  role: "participant",
  joinedAt: now,
  removedAt: null,
  ...over,
});

const enrollment = (over: Partial<TrackEnrollment> = {}): TrackEnrollment => ({
  trackId: tid,
  userId: uid,
  role: "participant",
  enrolledAt: now,
  leftAt: null,
  ...over,
});

const user = (over: Partial<User> = {}): User => ({
  id: uid,
  email: "u@example.com",
  name: "U",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
  ...over,
});

const group = (over: Partial<StudyGroup> = {}): StudyGroup => ({
  id: gid,
  name: "G",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

const track = (over: Partial<LearningTrack> = {}): LearningTrack => ({
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
  ...over,
});

const operator = (over: Partial<InstanceOperator> = {}): InstanceOperator => ({
  userId: uid,
  grantedAt: now,
  grantedBy: uid,
  revokedAt: null,
  ...over,
});

describe("isCurrentMember", () => {
  it("false when null", () => {
    expect(isCurrentMember(null, gid)).toBe(false);
  });
  it("false when removed", () => {
    expect(isCurrentMember(membership({ removedAt: now }), gid)).toBe(false);
  });
  it("false when membership belongs to a different group", () => {
    expect(isCurrentMember(membership({ groupId: otherGid }), gid)).toBe(false);
  });
  it("true when current and group matches", () => {
    expect(isCurrentMember(membership(), gid)).toBe(true);
  });
});

describe("isCurrentEnrollment", () => {
  it("false when null", () => {
    expect(isCurrentEnrollment(null, tid)).toBe(false);
  });
  it("false when left", () => {
    expect(isCurrentEnrollment(enrollment({ leftAt: now }), tid)).toBe(false);
  });
  it("false when enrollment belongs to a different track", () => {
    expect(isCurrentEnrollment(enrollment({ trackId: otherTid }), tid)).toBe(false);
  });
  it("true when current and track matches", () => {
    expect(isCurrentEnrollment(enrollment(), tid)).toBe(true);
  });
});

describe("isActiveOperator", () => {
  it("false when null", () => {
    expect(isActiveOperator(user(), null)).toBe(false);
  });
  it("false when revoked", () => {
    expect(isActiveOperator(user(), operator({ revokedAt: now }))).toBe(false);
  });
  it("false when userId mismatches actor", () => {
    expect(isActiveOperator(user(), operator({ userId: otherUid }))).toBe(false);
  });
  it("true when active operator belongs to actor", () => {
    expect(isActiveOperator(user(), operator())).toBe(true);
  });
});

describe("isWritable", () => {
  it("false when group archived", () => {
    expect(isWritable(group({ status: "archived" }), track())).toBe(false);
  });
  it("false when track archived (group active)", () => {
    expect(isWritable(group(), track({ status: "archived" }))).toBe(false);
  });
  it("true when both active", () => {
    expect(isWritable(group(), track())).toBe(true);
  });
  it("true when track is null (group-scope resource) and group active", () => {
    expect(isWritable(group(), null)).toBe(true);
  });
});
