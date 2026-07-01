import type {
  ActivityPartId,
  ActivityRecordId,
  LearningActivityId,
  LibraryRevisionId,
  UserId,
} from "../ids.ts";
import type { PartProgressState } from "./part-progress.ts";

export type CompletionState = "in_progress" | "completed";

/**
 * Rolled-up learner state for one (activity, participant). At most one row
 * exists per pair (DB UNIQUE). `completedAt` is non-null iff
 * `completionState === "completed"`.
 */
export type ActivityRecord = {
  readonly id: ActivityRecordId;
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
  readonly completionState: CompletionState;
  readonly completedAt: Date | null;
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
 * Wire shape returned by `GET /api/v1/activities/:id/my-record`. Deliberately
 * lean: it carries only what the Activity Player needs to hydrate the
 * participant's own surfaces — whether the viewer may author state at all,
 * and each Part's working state. Timestamps
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
 *
 * `completionState` is the activity-level rollup the Player needs to rehydrate
 * the completed chrome (header badge, the activity-complete CTA's hidden/shown
 * state) across a reload — `"in_progress"` until a record exists or is marked
 * complete. Without it, an activity completed under `manual_mark` would revert
 * to looking incomplete on the next mount.
 */
export type MyActivityRecordView = {
  readonly canParticipate: boolean;
  readonly completionState: CompletionState;
  readonly parts: ReadonlyArray<{
    readonly partId: ActivityPartId;
    readonly state: PartProgressState;
  }>;
  readonly partHistoryCount: number;
  readonly partsWithHistory: readonly ActivityPartId[];
};
