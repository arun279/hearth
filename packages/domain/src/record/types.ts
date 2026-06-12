import type { ActivityPartId, ActivityRecordId, LearningActivityId, UserId } from "../ids.ts";
import type { VisibilityPreference } from "../visibility/preference.ts";
import type { PartProgressState } from "./part-progress.ts";

export type CompletionState = "in_progress" | "completed";

/**
 * Rolled-up learner state for one (activity, participant). At most one row
 * exists per pair (DB UNIQUE). `completedAt` is non-null iff
 * `completionState === "completed"`. `visibilityOverride` is the per-record
 * choice; NULL means "use the user's default preference."
 */
export type ActivityRecord = {
  readonly id: ActivityRecordId;
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
  readonly completionState: CompletionState;
  readonly completedAt: Date | null;
  readonly visibilityOverride: VisibilityPreference | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PartProgress = {
  readonly id: string;
  readonly activityRecordId: ActivityRecordId;
  readonly partId: ActivityPartId;
  readonly state: PartProgressState;
  readonly updatedAt: Date;
};

/**
 * Wire shape returned by `GET /api/v1/activities/:id/my-record`. Deliberately
 * lean: it carries only what the Activity Player needs to hydrate the
 * participant's own surfaces — whether the viewer may author state at all,
 * the current visibility override, and each Part's working state. Timestamps
 * and the record id are omitted (no `Date`-over-JSON ambiguity; writes are
 * keyed by activity id + `my-record`, never the record id). `canParticipate`
 * is false for a viewer who can see the activity but is not a participant
 * (e.g. a facilitator outside a subset audience); the SPA renders the
 * interactive Parts read-only in that case.
 */
export type MyActivityRecordView = {
  readonly canParticipate: boolean;
  readonly visibilityOverride: VisibilityPreference | null;
  readonly parts: ReadonlyArray<{
    readonly partId: ActivityPartId;
    readonly state: PartProgressState;
  }>;
};
