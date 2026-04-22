import type { LearningTrackId, StudyGroupId, UserId } from "./ids.ts";

export type TrackStatus = "active" | "paused" | "archived";
export type TrackRole = "participant" | "facilitator";
export type ContributionMode = "direct" | "optional_review" | "required_review" | "none";

export type LearningTrack = {
  readonly id: LearningTrackId;
  readonly groupId: StudyGroupId;
  readonly name: string;
  readonly description: string | null;
  readonly status: TrackStatus;
  readonly pausedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly archivedBy: UserId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type TrackEnrollment = {
  readonly trackId: LearningTrackId;
  readonly userId: UserId;
  readonly role: TrackRole;
  readonly enrolledAt: Date;
  readonly leftAt: Date | null;
};
