import type { LearningTrackId, StudyGroupId, UserId } from "./ids.ts";

export type TrackStatus = "active" | "paused" | "archived";
export type TrackRole = "participant" | "facilitator";
export type ContributionMode = "direct" | "optional_review" | "required_review" | "none";

/**
 * Who may see a peer's coarse completion progress on this track.
 * - `shared` — every track peer sees who has completed what (the strong
 *   default; learning together is the point of a shared track).
 * - `facilitator_only` — peers see only their own row; the facilitator still
 *   sees everyone's.
 *
 * Governs only the non-ranked completion facts (`completionState`,
 * `completedAt`). It never exposes content (reflection prose, quiz answers,
 * part values — those stay owner-only) and never the facilitator-only retry
 * signal. A track-facilitator owns this choice (see
 * `canSetPeerProgressVisibility`).
 */
export type PeerProgressVisibility = "shared" | "facilitator_only";

/** New tracks default to `shared` — peers learning together see each other's progress. */
export const DEFAULT_PEER_PROGRESS_VISIBILITY: PeerProgressVisibility = "shared";

export type LearningTrack = {
  readonly id: LearningTrackId;
  readonly groupId: StudyGroupId;
  readonly name: string;
  readonly description: string | null;
  readonly status: TrackStatus;
  readonly peerProgressVisibility: PeerProgressVisibility;
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
