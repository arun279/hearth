import {
  type ActivityPartId,
  affectedPartIdsForRevisionBump,
  DomainError,
  type LearningActivityId,
  type LibraryRevisionId,
  type RevisionMap,
} from "@hearth/domain";
import type { ActivityRecordRepository, LearningActivityRepository } from "@hearth/ports";

export type RevisionBumpRestartInput = {
  readonly activityId: LearningActivityId;
  /** The Library Item whose current revision moved. */
  readonly libraryItemId: string;
  /** The item's revision before the bump (what affected Parts resolved to). */
  readonly previousRevisionId: LibraryRevisionId | null;
  /** The item's new current revision — recorded as the archived Parts'
   * `revisionIdAtTime`. */
  readonly newRevisionId: LibraryRevisionId;
};

export type RevisionBumpRestartResult = {
  readonly affectedPartIds: readonly ActivityPartId[];
  readonly reopenedRecordCount: number;
};

export type RevisionBumpRestartDeps = {
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
};

/**
 * Reopen the Parts of an unpinned, Library-backed activity when one of its
 * Library Items publishes a newer current revision. For every participant
 * with a record on the activity, the affected current Part values are
 * archived as Part History (`reason = revision_bump`, `revisionIdAtTime =
 * newRevisionId`) and reset to their kind-appropriate empty state in one D1
 * batch per record — prior work is never silently destroyed.
 *
 * IDEMPOTENT on two levels so a retried bump (same `newRevisionId`) is a
 * no-op: (1) when `previousRevisionId === newRevisionId` the affected set is
 * empty and no record is touched; (2) the adapter's `reopenAgainstRevision`
 * skips a Part whose latest history already names `newRevisionId`. Only
 * unpinned `read_library_item` / `listen_audio` / `watch_video` Parts whose
 * item revision actually changed participate (`affectedPartIdsForRevisionBump`).
 */
export async function revisionBumpRestart(
  input: RevisionBumpRestartInput,
  deps: RevisionBumpRestartDeps,
): Promise<RevisionBumpRestartResult> {
  const activity = await deps.activities.byId(input.activityId);
  if (!activity) {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }

  const oldRevisions: RevisionMap = new Map([[input.libraryItemId, input.previousRevisionId]]);
  const newRevisions: RevisionMap = new Map([[input.libraryItemId, input.newRevisionId]]);
  const affectedPartIds = affectedPartIdsForRevisionBump(activity, oldRevisions, newRevisions);
  if (affectedPartIds.length === 0) {
    return { affectedPartIds, reopenedRecordCount: 0 };
  }

  let reopenedRecordCount = 0;
  let cursor: string | undefined;
  do {
    const page = await deps.records.listByActivity(input.activityId, { cursor });
    for (const record of page.records) {
      await deps.records.reopenAgainstRevision({
        recordId: record.id,
        newRevisionId: input.newRevisionId,
        affectedPartIds,
        reason: "revision_bump",
      });
      reopenedRecordCount += 1;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);

  return { affectedPartIds, reopenedRecordCount };
}
