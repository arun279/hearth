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
  VisibilityPreference,
} from "@hearth/domain";
import type { Write } from "./_brand.ts";

/**
 * One Evidence Signal to persist — emitted while a participant works a
 * Part. The values are computed at the use-case layer; M11 wires the
 * enqueue surface and the coalescing UPSERT shape, but the throttled
 * batcher + the ≤ 50-write/user/day budget limiter that actually drive
 * `flushEvidenceSignals` ship in M17.
 */
export type EvidenceSignalInput = {
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
  readonly partId: ActivityPartId;
  readonly signalType: string;
  readonly value: unknown;
};

/**
 * Per-(activity, participant) learner state — the full M11 surface. Owns
 * resume (`upsert`), per-Part progress, the append-only `PartHistory` log,
 * the completion rollup, the record-level visibility override, and the
 * transactional `reopenAgainstRevision` restart primitive that moves
 * affected Part progress into history and resets it in one D1 batch.
 *
 * Mutations are `Write<>`-branded so the killswitch-coverage type gate
 * forces a CASES entry per write; reads are unbranded. Evidence-Signal
 * methods are declared here; their throttled use case ships in M17.
 */
export interface ActivityRecordRepository {
  // Records
  /** Get-or-create the record for (activity, participant). Idempotent. */
  upsert: Write<
    (args: { activityId: LearningActivityId; participantId: UserId }) => Promise<ActivityRecord>
  >;
  byId(id: ActivityRecordId): Promise<ActivityRecord | null>;
  byParticipantAndActivity(
    activityId: LearningActivityId,
    participantId: UserId,
  ): Promise<ActivityRecord | null>;
  listByActivity(
    activityId: LearningActivityId,
    opts?: { cursor?: string; limit?: number },
  ): Promise<{ records: readonly ActivityRecord[]; nextCursor: string | null }>;

  setCompletion: Write<
    (args: { id: ActivityRecordId; state: CompletionState; at: Date }) => Promise<void>
  >;
  setVisibilityOverride: Write<
    (id: ActivityRecordId, override: VisibilityPreference | null) => Promise<void>
  >;

  // Part progress
  getPartProgress(args: {
    activityRecordId: ActivityRecordId;
    partId: ActivityPartId;
  }): Promise<PartProgress | null>;
  listPartProgress(activityRecordId: ActivityRecordId): Promise<readonly PartProgress[]>;
  savePartProgress: Write<
    (args: {
      activityRecordId: ActivityRecordId;
      partId: ActivityPartId;
      state: PartProgressState;
    }) => Promise<void>
  >;
  /**
   * Flip ONLY the `completed` flag on a Part, leaving the rest of the
   * progress envelope (reflection prose, quiz answers, resume cursor)
   * untouched. A targeted patch — not a read-modify-write of the whole
   * envelope — so a concurrent in-flight autosave can never be clobbered by
   * a stale client-supplied value when a learner marks a Part complete mid
   * autosave-debounce. The adapter patches the persisted JSON server-side
   * (D1 `json_set` on the existing `state_json` column). Creates the row at
   * the Part's initial state first if none exists yet.
   */
  setPartCompletion: Write<
    (args: {
      activityRecordId: ActivityRecordId;
      partId: ActivityPartId;
      completed: boolean;
      initialState: PartProgressState;
    }) => Promise<void>
  >;

  // Part history
  appendPartHistory: Write<
    (args: {
      activityRecordId: ActivityRecordId;
      partId: ActivityPartId;
      snapshot: PartProgressState;
      reason: PartHistoryReason;
      revisionIdAtTime?: LibraryRevisionId;
    }) => Promise<void>
  >;
  listPartHistory(
    activityRecordId: ActivityRecordId,
    opts?: { partId?: ActivityPartId },
  ): Promise<readonly PartHistory[]>;
  countPartHistory(activityRecordId: ActivityRecordId): Promise<number>;
  /**
   * The distinct Part ids that have at least one history row, projected via
   * `SELECT DISTINCT part_id` so a record read can flag which Parts carry a
   * history affordance without decoding every archived `state_json`
   * envelope. Backed by the `(activity_record_id, part_id)` index.
   */
  partsWithHistory(activityRecordId: ActivityRecordId): Promise<readonly ActivityPartId[]>;

  // Revision restart (one transaction; archives affected progress into
  // history and resets it, so prior work is never silently destroyed)
  reopenAgainstRevision: Write<
    (args: {
      recordId: ActivityRecordId;
      /** The revision the activity moved to — recorded as each archived
       * Part's `revisionIdAtTime`. `null` for a `facilitator_reset`, which
       * archives current progress without a revision change. */
      newRevisionId: LibraryRevisionId | null;
      affectedPartIds: readonly ActivityPartId[];
      reason: PartHistoryReason;
    }) => Promise<void>
  >;

  // Evidence Signals — coalescing UPSERT batch (≤32 per call enforced upstream)
  flushEvidenceSignals: Write<(signals: readonly EvidenceSignalInput[]) => Promise<void>>;
}
