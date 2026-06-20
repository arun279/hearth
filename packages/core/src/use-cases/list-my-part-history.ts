import type { ActivityPartId, LearningActivityId, PartHistory, UserId } from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import { type LoadOwnRecordDeps, loadOwnRecordContext } from "./_lib/load-own-record-context.ts";

export type ListMyPartHistoryInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  /** Narrow to one Part; omit to list every Part's history for the record. */
  readonly partId?: ActivityPartId;
};

export type ListMyPartHistoryDeps = LoadOwnRecordDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * The owner-addressed Part History read — what `<PartHistoryDrawer>` opens
 * against for the participant's own record. Mirrors the own-record WRITE
 * addressing (activity id + `my-record`, never the record id), so the owner
 * reaches their history without the record id the lean own-record path hides.
 * The record is resolved internally; an owner who never wrote (no record yet)
 * gets an empty list rather than a 404, matching the empty-Player read path.
 *
 * Viewability runs via `loadOwnRecordContext` (a non-audience viewer 404s on
 * the activity), so the activity id is not an enumeration oracle.
 */
export async function listMyPartHistory(
  input: ListMyPartHistoryInput,
  deps: ListMyPartHistoryDeps,
): Promise<readonly PartHistory[]> {
  await loadOwnRecordContext(input.actor, input.activityId, deps);
  const record = await deps.records.byParticipantAndActivity(input.activityId, input.actor);
  if (!record) return [];
  return deps.records.listPartHistory(record.id, { partId: input.partId });
}
