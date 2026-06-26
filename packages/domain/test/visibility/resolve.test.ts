import { describe, expect, it } from "vitest";
import type { GroupMembership } from "../../src/group.ts";
import type {
  ActivityRecordId,
  LearningActivityId,
  LearningTrackId,
  StudyGroupId,
  UserId,
} from "../../src/ids.ts";
import type { ActivityRecord } from "../../src/record/types.ts";
import type { TrackEnrollment, TrackRole } from "../../src/track.ts";
import type { User } from "../../src/user.ts";
import type { VisibilityPreference, VisibilityScope } from "../../src/visibility/preference.ts";
import { resolveActivityRecordScope } from "../../src/visibility/resolve.ts";

const now = new Date("2026-06-01T00:00:00.000Z");

const GROUP_ID = "g_1" as StudyGroupId;
const TRACK_ID = "t_1" as LearningTrackId;
const PARTICIPANT_ID = "u_participant" as UserId;
const VIEWER_ID = "u_viewer" as UserId;

function makeViewer(id: UserId = VIEWER_ID): User {
  return {
    id,
    email: "v@example.com",
    name: "Viewer",
    image: null,
    deactivatedAt: null,
    deletedAt: null,
    attributionPreference: "preserve_name",
    createdAt: now,
    updatedAt: now,
  };
}

function makeRecord(visibilityOverride: VisibilityPreference | null = null): ActivityRecord {
  return {
    id: "ar_1" as ActivityRecordId,
    activityId: "a_1" as LearningActivityId,
    participantId: PARTICIPANT_ID,
    completionState: "completed",
    completedAt: now,
    visibilityOverride,
    createdAt: now,
    updatedAt: now,
  };
}

function makeMembership(removedAt: Date | null = null): GroupMembership {
  return {
    groupId: GROUP_ID,
    userId: VIEWER_ID,
    role: "participant",
    joinedAt: now,
    removedAt,
    removedBy: null,
    attributionOnLeave: null,
    displayNameSnapshot: null,
    profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
  };
}

function makeEnrollment(role: TrackRole, leftAt: Date | null = null): TrackEnrollment {
  return { trackId: TRACK_ID, userId: VIEWER_ID, role, enrolledAt: now, leftAt };
}

function resolve(args: {
  record?: ActivityRecord;
  viewer?: User;
  viewerMembership?: GroupMembership | null;
  viewerEnrollment?: TrackEnrollment | null;
  participantPreference?: VisibilityPreference;
}): VisibilityScope {
  return resolveActivityRecordScope({
    record: args.record ?? makeRecord(),
    viewer: args.viewer ?? makeViewer(),
    groupId: GROUP_ID,
    trackId: TRACK_ID,
    viewerMembership:
      args.viewerMembership === undefined ? makeMembership() : args.viewerMembership,
    viewerEnrollment: args.viewerEnrollment ?? null,
    participantPreference: args.participantPreference ?? "default",
  });
}

describe("resolveActivityRecordScope — branch order", () => {
  it("(1) the participant always sees their own record in full, regardless of context", () => {
    for (const preference of ["default", "track_only", "private"] as const) {
      const scope = resolveActivityRecordScope({
        record: makeRecord("private"),
        viewer: makeViewer(PARTICIPANT_ID),
        groupId: GROUP_ID,
        trackId: TRACK_ID,
        viewerMembership: null,
        viewerEnrollment: null,
        participantPreference: preference,
      });
      expect(scope).toBe("full");
    }
  });

  it("(2) a non-member sees hidden (null membership)", () => {
    expect(resolve({ viewerMembership: null })).toBe("hidden");
  });

  it("(2) a removed member sees hidden even with a facilitator enrollment (branch 2 precedes 3)", () => {
    expect(
      resolve({
        viewerMembership: makeMembership(now),
        viewerEnrollment: makeEnrollment("facilitator"),
      }),
    ).toBe("hidden");
  });

  it("(3) a current Track Facilitator always sees full, even when the record is private", () => {
    expect(
      resolve({
        record: makeRecord("private"),
        viewerEnrollment: makeEnrollment("facilitator"),
        participantPreference: "private",
      }),
    ).toBe("full");
  });

  it("(3) a facilitator who has left the track does not get the facilitator full path", () => {
    expect(
      resolve({
        record: makeRecord("private"),
        viewerEnrollment: makeEnrollment("facilitator", now),
        participantPreference: "private",
      }),
    ).toBe("hidden");
  });

  it("(4) a per-record override beats the participant default preference", () => {
    expect(
      resolve({
        record: makeRecord("private"),
        viewerEnrollment: makeEnrollment("participant"),
        participantPreference: "default",
      }),
    ).toBe("summary");
    expect(
      resolve({
        record: makeRecord("default"),
        viewerEnrollment: makeEnrollment("participant"),
        participantPreference: "private",
      }),
    ).toBe("full");
  });
});

const TRACK_ENROLLEE_MATRIX: ReadonlyArray<[VisibilityPreference, VisibilityScope]> = [
  ["default", "full"],
  ["track_only", "full"],
  ["private", "summary"],
];

const GROUP_MEMBER_MATRIX: ReadonlyArray<[VisibilityPreference, VisibilityScope]> = [
  ["default", "summary"],
  ["track_only", "hidden"],
  ["private", "hidden"],
];

describe("resolveActivityRecordScope — viewer-context × preference matrices", () => {
  describe("current track participant-enrollee", () => {
    for (const [preference, expected] of TRACK_ENROLLEE_MATRIX) {
      it(`effective ${preference} → ${expected}`, () => {
        expect(
          resolve({
            viewerEnrollment: makeEnrollment("participant"),
            participantPreference: preference,
          }),
        ).toBe(expected);
      });
    }
  });

  describe("group member not in the track (no enrollment)", () => {
    for (const [preference, expected] of GROUP_MEMBER_MATRIX) {
      it(`effective ${preference} → ${expected}`, () => {
        expect(resolve({ viewerEnrollment: null, participantPreference: preference })).toBe(
          expected,
        );
      });
    }
  });

  describe("group member whose track enrollment has lapsed (treated as not-in-track)", () => {
    for (const [preference, expected] of GROUP_MEMBER_MATRIX) {
      it(`left participant-enrollee, effective ${preference} → ${expected}`, () => {
        expect(
          resolve({
            viewerEnrollment: makeEnrollment("participant", now),
            participantPreference: preference,
          }),
        ).toBe(expected);
      });
    }
  });
});
