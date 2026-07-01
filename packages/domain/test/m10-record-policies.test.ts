import { describe, expect, it } from "vitest";
import type { ActivityAudience } from "../src/activity/types.ts";
import type { LearningTrackId, StudyGroupId, UserId } from "../src/ids.ts";
import { canRecordOwnActivityProgress } from "../src/policy/can-record-own-activity-progress.ts";
import type { LearningTrack, TrackEnrollment } from "../src/track.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-05-30T00:00:00.000Z");
const uid = "u_actor" as UserId;
const otherUid = "u_other" as UserId;
const gid = "g_1" as StudyGroupId;
const tid = "t_1" as LearningTrackId;
const otherTid = "t_2" as LearningTrackId;

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

const track: LearningTrack = {
  id: tid,
  groupId: gid,
  name: "T",
  description: null,
  status: "active",
  peerProgressVisibility: "shared",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const currentEnrollment: TrackEnrollment = {
  trackId: tid,
  userId: uid,
  role: "participant",
  enrolledAt: now,
  leftAt: null,
};

const everyone: ActivityAudience = { kind: "everyone_enrolled" };
const subsetWithActor: ActivityAudience = { kind: "subset", userIds: [uid, otherUid] };
const subsetWithoutActor: ActivityAudience = { kind: "subset", userIds: [otherUid] };

describe("canRecordOwnActivityProgress", () => {
  it("allows a current enrollee under an everyone-enrolled audience", () => {
    const verdict = canRecordOwnActivityProgress(actor, track, everyone, currentEnrollment);
    expect(verdict.ok).toBe(true);
  });

  it("allows a current enrollee listed in a subset audience", () => {
    const verdict = canRecordOwnActivityProgress(actor, track, subsetWithActor, currentEnrollment);
    expect(verdict.ok).toBe(true);
  });

  it("denies (not_in_audience) a current enrollee excluded from a subset audience", () => {
    const verdict = canRecordOwnActivityProgress(
      actor,
      track,
      subsetWithoutActor,
      currentEnrollment,
    );
    expect(verdict).toMatchObject({ ok: false, reason: { code: "not_in_audience" } });
  });

  it("denies (not_track_enrollee) when there is no enrollment", () => {
    const verdict = canRecordOwnActivityProgress(actor, track, everyone, null);
    expect(verdict).toMatchObject({ ok: false, reason: { code: "not_track_enrollee" } });
  });

  it("denies (not_track_enrollee) when the enrollment has been left", () => {
    const left: TrackEnrollment = { ...currentEnrollment, leftAt: now };
    const verdict = canRecordOwnActivityProgress(actor, track, everyone, left);
    expect(verdict).toMatchObject({ ok: false, reason: { code: "not_track_enrollee" } });
  });

  it("denies (not_track_enrollee) when the enrollment is for a different track", () => {
    const elsewhere: TrackEnrollment = { ...currentEnrollment, trackId: otherTid };
    const verdict = canRecordOwnActivityProgress(actor, track, everyone, elsewhere);
    expect(verdict).toMatchObject({ ok: false, reason: { code: "not_track_enrollee" } });
  });
});
