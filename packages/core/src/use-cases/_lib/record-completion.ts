import type { ActivityPartId, ActivityRecordId, LearningActivity } from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";

/**
 * Are every one of the activity's Parts marked `completed` in this record?
 * Backs the `all_parts_complete` Completion Rule's auto-complete trigger. A
 * Part with no progress row (never touched) counts as not complete, so an
 * activity with an untouched Part can never auto-complete. Reads the live
 * progress rows rather than trusting a caller-supplied snapshot so the
 * decision reflects what is actually persisted.
 */
export async function allPartsComplete(
  recordId: ActivityRecordId,
  activity: LearningActivity,
  records: ActivityRecordRepository,
): Promise<boolean> {
  if (activity.parts.length === 0) return false;
  const progress = await records.listPartProgress(recordId);
  const completedPartIds = new Set<ActivityPartId>(
    progress.filter((p) => p.state.completed).map((p) => p.partId),
  );
  return activity.parts.every((part) => completedPartIds.has(part.id as ActivityPartId));
}

/**
 * Are every hard prerequisite of `targetPartId` satisfied by the record's
 * current progress? A `hard` Flow edge (`fromPartId → toPartId`) blocks: the
 * `toPart` may not be marked complete until its `fromPart` is. Soft edges are
 * ordering hints and never gate. With no incoming hard edges the Part is
 * always eligible.
 */
export function hardPrereqsMet(
  activity: LearningActivity,
  targetPartId: string,
  completedPartIds: ReadonlySet<string>,
): boolean {
  return activity.flow.prereqs
    .filter((edge) => edge.kind === "hard" && edge.toPartId === targetPartId)
    .every((edge) => completedPartIds.has(edge.fromPartId));
}
