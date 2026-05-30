import type {
  ActivityPartId,
  ActivityRecord,
  ActivityRecordId,
  CompletionState,
  LearningActivityId,
  LibraryRevisionId,
  PartHistory,
  PartHistoryReason,
  PartProgress,
  PartProgressState,
  UserId,
} from "@hearth/domain";
import type { VisibilityPreference } from "@hearth/domain/visibility";
import type { Write } from "./_brand.ts";

export type UpsertActivityRecordInput = {
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
  readonly now: Date;
};

export type SavePartProgressInput = {
  readonly activityRecordId: ActivityRecordId;
  readonly partId: ActivityPartId;
  readonly state: PartProgressState;
  readonly now: Date;
  /**
   * When true, the existing Part Progress (if any) is snapshotted into Part
   * History as a `retry` inside the same transaction before the new state
   * overwrites it — how a quiz re-submission preserves the prior attempt.
   * Omitted for reflection autosave, where continuous edits are not retries.
   */
  readonly snapshotPriorAsRetry?: boolean;
};

export type ReopenPartReset = {
  readonly partId: ActivityPartId;
  /** The kind-appropriate empty state the Part is reset to. */
  readonly resetState: PartProgressState;
};

export type ReopenAgainstRevisionInput = {
  readonly recordId: ActivityRecordId;
  readonly reason: PartHistoryReason;
  /** The revision the Parts are reopened against (`revision_bump`); `null` for a reset. */
  readonly revisionIdAtTime: LibraryRevisionId | null;
  readonly resets: readonly ReopenPartReset[];
  readonly now: Date;
};

/**
 * Drives the Activity Record aggregate (records + part progress + part
 * history) from the use-case layer. The Cloudflare adapter is the only
 * place that touches D1; every mutating method (carrying the `Write<>`
 * brand) calls `gate.assertWritable()` first — the killswitch-coverage
 * test enumerates the branded methods, so adding one without a CASES entry
 * is a compile error.
 *
 * Evidence Signals (assistive resume cursors) are deliberately absent —
 * their ingest, batching, and write-budget belong to a later milestone;
 * authoritative per-Part state lives in `part_progress`, not signals.
 */
export interface ActivityRecordRepository {
  /** Create-or-return the single record for (activity, participant). Idempotent under a race. */
  upsert: Write<(input: UpsertActivityRecordInput) => Promise<ActivityRecord>>;

  byId(id: ActivityRecordId): Promise<ActivityRecord | null>;

  byParticipantAndActivity(args: {
    activityId: LearningActivityId;
    participantId: UserId;
  }): Promise<ActivityRecord | null>;

  /** Every participant's record for an activity — the facilitator's roster view. */
  listByActivity(activityId: LearningActivityId): Promise<readonly ActivityRecord[]>;

  /** `at` is the transition timestamp — `completedAt` when completing, and `updatedAt` either way. */
  setCompletion: Write<
    (args: { id: ActivityRecordId; state: CompletionState; at: Date }) => Promise<ActivityRecord>
  >;

  setVisibilityOverride: Write<
    (args: {
      id: ActivityRecordId;
      override: VisibilityPreference | null;
      now: Date;
    }) => Promise<ActivityRecord>
  >;

  getPartProgress(args: {
    activityRecordId: ActivityRecordId;
    partId: ActivityPartId;
  }): Promise<PartProgress | null>;

  listPartProgress(activityRecordId: ActivityRecordId): Promise<readonly PartProgress[]>;

  /** Upsert one Part's progress; optionally snapshot the prior state to history first. */
  savePartProgress: Write<(input: SavePartProgressInput) => Promise<PartProgress>>;

  listPartHistory(args: {
    activityRecordId: ActivityRecordId;
    partId?: ActivityPartId;
  }): Promise<readonly PartHistory[]>;

  countPartHistory(activityRecordId: ActivityRecordId): Promise<number>;

  /**
   * Preserve-then-reset the given Parts in one transaction: snapshot each
   * Part's current progress into Part History, then reset it to its empty
   * state. Backs both the revision-bump restart and the facilitator reset.
   * Idempotent for `revision_bump` — a Part whose latest history already
   * records `revisionIdAtTime` is skipped, so re-running is a no-op.
   */
  reopenAgainstRevision: Write<(input: ReopenAgainstRevisionInput) => Promise<void>>;
}
