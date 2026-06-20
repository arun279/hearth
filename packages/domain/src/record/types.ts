import type {
  ActivityPartId,
  ActivityRecordId,
  LearningActivityId,
  LibraryRevisionId,
  UserId,
} from "../ids.ts";
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
 * Why a `PartProgress` value was archived into `PartHistory`.
 * - `retry` — the learner overwrote a prior attempt (e.g. re-took a quiz).
 * - `revision_bump` — an unpinned Library-backed Part saw a newer current
 *   revision, so its progress was reopened and the prior value preserved.
 * - `facilitator_reset` — a Track Facilitator reset the participant's
 *   progress for the whole activity.
 *
 * The wire strings match the M0 `part_history.reason` CHECK constraint.
 */
export type PartHistoryReason = "retry" | "revision_bump" | "facilitator_reset";

/**
 * An append-only snapshot of a `PartProgress` value at the moment it was
 * superseded. The contract that makes resume/restart safe: prior work is
 * never silently destroyed — it moves here. `revisionIdAtTime` is set only
 * for the `revision_bump` case (FK to `library_revisions`), naming the
 * revision the activity moved to when the Part was reopened.
 */
export type PartHistory = {
  readonly id: string;
  readonly activityRecordId: ActivityRecordId;
  readonly partId: ActivityPartId;
  readonly snapshot: PartProgressState;
  readonly reason: PartHistoryReason;
  readonly revisionIdAtTime: LibraryRevisionId | null;
  readonly recordedAt: Date;
};

/**
 * One Evidence Signal emitted while a participant works a Part — the raw
 * material a future analytics/auto-complete layer (M17) consumes. The
 * `value` is opaque JSON validated at ingest, not in the domain. M11
 * declares the type + port surface; the throttled batcher + write-budget
 * limiter that actually persist these ship in M17.
 */
export type EvidenceSignal = {
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
  readonly partId: ActivityPartId;
  readonly signalType: string;
  readonly value: unknown;
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
 *
 * `partHistoryCount` + `partsWithHistory` carry the same two history rollups
 * `ActivityRecordFullView` exposes, so the owner's Player renders the
 * activity-level "N prior attempts preserved" chip and the per-Part history
 * affordance from this single read — without the record id this path hides.
 * Both are `0` / `[]` until a record exists.
 */
export type MyActivityRecordView = {
  readonly canParticipate: boolean;
  readonly visibilityOverride: VisibilityPreference | null;
  readonly parts: ReadonlyArray<{
    readonly partId: ActivityPartId;
    readonly state: PartProgressState;
  }>;
  readonly partHistoryCount: number;
  readonly partsWithHistory: readonly ActivityPartId[];
};
