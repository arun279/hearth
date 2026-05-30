import {
  type ActivityPartId,
  affectedPartIdsForRevisionBump,
  initialPartProgressState,
  type LearningActivityId,
  type LibraryRevisionId,
} from "@hearth/domain";
import type { ActivityRecordRepository, Clock, LearningActivityRepository } from "@hearth/ports";

export type RevisionBumpRestartInput = {
  readonly activityId: LearningActivityId;
  readonly bumpedLibraryItemId: string;
  readonly newRevisionId: LibraryRevisionId;
};

export type RevisionBumpRestartDeps = {
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * Restart the Parts of every participant's record when a Library Item
 * publishes a newer Revision. Only Parts that reference the bumped item
 * through an UNPINNED ref are affected (`affectedPartIdsForRevisionBump`
 * filters pinned refs); their prior work is snapshotted into Part History
 * (`revision_bump`) before being reset. System-triggered — no actor — and
 * idempotent: the adapter skips a Part whose latest history already records
 * the target revision, so re-running the same bump is a no-op.
 */
export async function revisionBumpRestart(
  input: RevisionBumpRestartInput,
  deps: RevisionBumpRestartDeps,
): Promise<void> {
  const activity = await deps.activities.byId(input.activityId);
  if (!activity) return;

  const affectedPartIds = new Set(
    affectedPartIdsForRevisionBump(activity, input.bumpedLibraryItemId),
  );
  if (affectedPartIds.size === 0) return;

  const resets = activity.parts
    .filter((p) => affectedPartIds.has(p.id))
    .map((p) => ({ partId: p.id as ActivityPartId, resetState: initialPartProgressState(p) }));

  const now = deps.clock.now();
  const records = await deps.records.listByActivity(input.activityId);
  for (const record of records) {
    await deps.records.reopenAgainstRevision({
      recordId: record.id,
      reason: "revision_bump",
      revisionIdAtTime: input.newRevisionId,
      resets,
      now,
    });
  }
}
