import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import { canCreateLearningActivity } from "../src/policy/can-create-learning-activity.ts";
import { canDeleteLearningActivity } from "../src/policy/can-delete-learning-activity.ts";
import { canEditLearningActivity } from "../src/policy/can-edit-learning-activity.ts";
import { canNarrowAudience } from "../src/policy/can-narrow-audience.ts";
import { canPinLibraryRevision } from "../src/policy/can-pin-library-revision.ts";
import { canSetPrerequisites } from "../src/policy/can-set-prerequisites.ts";
import { canSetSuggestedSequences } from "../src/policy/can-set-suggested-sequences.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const uid = "u_actor" as UserId;
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
const pausedTrack: LearningTrack = { ...activeTrack, status: "paused", pausedAt: now };
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

describe("canCreateLearningActivity", () => {
  it("allows a track facilitator on an active track", () => {
    expect(
      canCreateLearningActivity(
        actor,
        activeGroup,
        activeTrack,
        participantMembership,
        facilitatorEnrollment,
      ).ok,
    ).toBe(true);
  });

  it("allows a group admin without enrollment", () => {
    expect(
      canCreateLearningActivity(actor, activeGroup, activeTrack, adminMembership, null).ok,
    ).toBe(true);
  });

  it("rejects on archived parent group", () => {
    const r = canCreateLearningActivity(
      actor,
      archivedGroup,
      activeTrack,
      adminMembership,
      facilitatorEnrollment,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });

  it("rejects on archived track", () => {
    const r = canCreateLearningActivity(
      actor,
      activeGroup,
      archivedTrack,
      adminMembership,
      facilitatorEnrollment,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });

  it("rejects on paused track (no new work opens)", () => {
    const r = canCreateLearningActivity(
      actor,
      activeGroup,
      pausedTrack,
      adminMembership,
      facilitatorEnrollment,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_paused");
  });

  it("rejects a non-authority actor", () => {
    const r = canCreateLearningActivity(
      actor,
      activeGroup,
      activeTrack,
      participantMembership,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
});

describe("canEditLearningActivity", () => {
  it("allows a track facilitator on an active track", () => {
    expect(
      canEditLearningActivity(
        actor,
        activeGroup,
        activeTrack,
        participantMembership,
        facilitatorEnrollment,
      ).ok,
    ).toBe(true);
  });

  it("allows a group admin without enrollment", () => {
    expect(canEditLearningActivity(actor, activeGroup, activeTrack, adminMembership, null).ok).toBe(
      true,
    );
  });

  it("allows on a paused track (in-flight edits stay possible)", () => {
    expect(
      canEditLearningActivity(
        actor,
        activeGroup,
        pausedTrack,
        adminMembership,
        facilitatorEnrollment,
      ).ok,
    ).toBe(true);
  });

  it("rejects on archived parent group", () => {
    const r = canEditLearningActivity(
      actor,
      archivedGroup,
      activeTrack,
      adminMembership,
      facilitatorEnrollment,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });

  it("rejects on archived track", () => {
    const r = canEditLearningActivity(
      actor,
      activeGroup,
      archivedTrack,
      adminMembership,
      facilitatorEnrollment,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });

  it("rejects a non-authority actor", () => {
    const r = canEditLearningActivity(actor, activeGroup, activeTrack, participantMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
});

/**
 * Five Activity-scope policies share a single gate (track-authority +
 * non-archived parent + non-archived track) but each captures its own
 * intent so the call sites read clearly. The shared cases below cover
 * the gate for all five; per-policy quirks (none in v1) would land as
 * dedicated `describe` blocks.
 */
describe.each([
  ["canDeleteLearningActivity", canDeleteLearningActivity, "delete"],
  ["canPinLibraryRevision", canPinLibraryRevision, "pin"],
  ["canSetPrerequisites", canSetPrerequisites, "prereq"],
  ["canSetSuggestedSequences", canSetSuggestedSequences, "suggested"],
  ["canNarrowAudience", canNarrowAudience, "audience"],
])("%s (Activity-scope gate)", (_name, predicate) => {
  it("allows a track facilitator on an active track", () => {
    expect(
      predicate(actor, activeGroup, activeTrack, participantMembership, facilitatorEnrollment).ok,
    ).toBe(true);
  });

  it("allows a group admin without enrollment", () => {
    expect(predicate(actor, activeGroup, activeTrack, adminMembership, null).ok).toBe(true);
  });

  it("allows on a paused track (in-flight edits stay possible)", () => {
    expect(
      predicate(actor, activeGroup, pausedTrack, adminMembership, facilitatorEnrollment).ok,
    ).toBe(true);
  });

  it("rejects on archived parent group", () => {
    const r = predicate(actor, archivedGroup, activeTrack, adminMembership, facilitatorEnrollment);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });

  it("rejects on archived track", () => {
    const r = predicate(actor, activeGroup, archivedTrack, adminMembership, facilitatorEnrollment);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });

  it("rejects a non-authority actor", () => {
    const r = predicate(actor, activeGroup, activeTrack, participantMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_track_authority");
  });
});
