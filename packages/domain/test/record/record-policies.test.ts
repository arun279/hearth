import { describe, expect, it } from "vitest";
import type { ActivityAccessState } from "../../src/activity/types.ts";
import type { ActivityRecordId, LearningActivityId, UserId } from "../../src/ids.ts";
import {
  canMarkActivityComplete,
  canMarkPartComplete,
  canOverrideActivityRecordVisibility,
  canResetParticipantProgress,
  canViewActivityRecord,
} from "../../src/policy/record.ts";
import type { ActivityRecord } from "../../src/record/types.ts";
import type { User } from "../../src/user.ts";

const now = new Date("2026-06-01T00:00:00.000Z");
const ownerId = "u_owner" as UserId;
const otherId = "u_other" as UserId;

function user(id: UserId): User {
  return {
    id,
    email: `${id}@x.com`,
    name: null,
    image: null,
    deactivatedAt: null,
    deletedAt: null,
    attributionPreference: "preserve_name",
    createdAt: now,
    updatedAt: now,
  };
}

const owner = user(ownerId);
const other = user(otherId);

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

const open: ActivityAccessState = "open";

describe("canMarkPartComplete", () => {
  it("allows the owner with prereqs met on an open activity", () => {
    expect(canMarkPartComplete(owner, record, true, open).ok).toBe(true);
  });

  it("denies (not_record_owner) a non-owner", () => {
    expect(canMarkPartComplete(other, record, true, open)).toMatchObject({
      ok: false,
      reason: { code: "not_record_owner" },
    });
  });

  it("denies (prereq_not_met) when a hard prerequisite is unmet", () => {
    expect(canMarkPartComplete(owner, record, false, open)).toMatchObject({
      ok: false,
      reason: { code: "prereq_not_met" },
    });
  });

  it("denies (activity_window_closed) on a locked activity", () => {
    expect(canMarkPartComplete(owner, record, true, "locked")).toMatchObject({
      ok: false,
      reason: { code: "activity_window_closed" },
    });
  });

  it("denies (activity_window_closed) on a hidden activity", () => {
    expect(canMarkPartComplete(owner, record, true, "hidden")).toMatchObject({
      ok: false,
      reason: { code: "activity_window_closed" },
    });
  });

  it("ranks the window close ahead of an unmet prerequisite", () => {
    expect(canMarkPartComplete(owner, record, false, "locked")).toMatchObject({
      ok: false,
      reason: { code: "activity_window_closed" },
    });
  });
});

describe("canMarkActivityComplete", () => {
  it("allows the owner when all Parts are complete on an open activity", () => {
    expect(canMarkActivityComplete(owner, record, true, open).ok).toBe(true);
  });

  it("denies (not_record_owner) a non-owner", () => {
    expect(canMarkActivityComplete(other, record, true, open)).toMatchObject({
      ok: false,
      reason: { code: "not_record_owner" },
    });
  });

  it("denies (parts_incomplete) when not every Part is complete", () => {
    expect(canMarkActivityComplete(owner, record, false, open)).toMatchObject({
      ok: false,
      reason: { code: "parts_incomplete" },
    });
  });

  it("denies (activity_window_closed) on a closed activity even when complete", () => {
    expect(canMarkActivityComplete(owner, record, true, "locked")).toMatchObject({
      ok: false,
      reason: { code: "activity_window_closed" },
    });
  });
});

describe("canResetParticipantProgress", () => {
  it("allows a track authority", () => {
    expect(canResetParticipantProgress(true).ok).toBe(true);
  });

  it("denies (not_track_authority) a non-authority", () => {
    expect(canResetParticipantProgress(false)).toMatchObject({
      ok: false,
      reason: { code: "not_track_authority" },
    });
  });
});

describe("canOverrideActivityRecordVisibility", () => {
  it("allows the owner", () => {
    expect(canOverrideActivityRecordVisibility(owner, record).ok).toBe(true);
  });

  it("denies (not_record_owner) a non-owner", () => {
    expect(canOverrideActivityRecordVisibility(other, record)).toMatchObject({
      ok: false,
      reason: { code: "not_record_owner" },
    });
  });
});

describe("canViewActivityRecord", () => {
  it("allows the participant at full scope", () => {
    expect(canViewActivityRecord(owner, record)).toEqual({ ok: true, scope: "full" });
  });

  it("denies (not_record_owner) a non-participant in M11", () => {
    expect(canViewActivityRecord(other, record)).toMatchObject({
      ok: false,
      reason: { code: "not_record_owner" },
    });
  });
});
