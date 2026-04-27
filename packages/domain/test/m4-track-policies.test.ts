import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import { canArchiveTrack } from "../src/policy/can-archive-track.ts";
import { canEditContributionPolicy } from "../src/policy/can-edit-contribution-policy.ts";
import { canEditTrackMetadata } from "../src/policy/can-edit-track-metadata.ts";
import { canEditTrackStructure } from "../src/policy/can-edit-track-structure.ts";
import { canPauseTrack } from "../src/policy/can-pause-track.ts";
import { canResumeTrack } from "../src/policy/can-resume-track.ts";
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

// All three policies share the authority shape (group active + track
// authority). canPauseTrack and canResumeTrack additionally deny on
// archived tracks — pausing or resuming an archived track is logically
// invalid, so denying at the policy keeps `caps.canPause/Resume` honest
// for SPA gating. canArchiveTrack stays authority-only because archive
// is idempotent (re-archive = no-op success in the use case, matching
// `canArchiveGroup`'s shape).
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

// Pause and resume specifically deny archived tracks (the operation is
// not idempotent on archived — the transitions table rejects, but the
// policy denies first so the cap surface is honest). Archive does NOT
// deny on archived because archive-on-archived is idempotent.
describe.each([
  { name: "canPauseTrack", fn: canPauseTrack },
  { name: "canResumeTrack", fn: canResumeTrack },
])("$name (track-archived gate)", ({ fn }) => {
  it("denies on an archived track with track_archived", () => {
    const r = fn(actor, activeGroup, archivedTrack, adminMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("track_archived");
  });
});

it("canArchiveTrack allows re-archive on an archived track (idempotent path)", () => {
  expect(canArchiveTrack(actor, activeGroup, archivedTrack, adminMembership, null).ok).toBe(true);
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
