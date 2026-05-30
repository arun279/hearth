import type { ActivityRecord, PartProgress } from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";

/**
 * The resume/roster view of one Activity Record: the rolled-up record plus
 * the per-Part progress and the history fan-out the SPA needs to render the
 * "N earlier attempts" affordance without an extra round-trip. `partsWithHistory`
 * is the distinct set of Part ids that have at least one history snapshot;
 * `partHistoryCount` is the total snapshot count across the record.
 */
export type ActivityRecordView = {
  readonly record: ActivityRecord;
  readonly partProgress: readonly PartProgress[];
  readonly partsWithHistory: readonly string[];
  readonly partHistoryCount: number;
};

export async function loadRecordView(
  record: ActivityRecord,
  records: ActivityRecordRepository,
): Promise<ActivityRecordView> {
  const [partProgress, history, partHistoryCount] = await Promise.all([
    records.listPartProgress(record.id),
    records.listPartHistory({ activityRecordId: record.id }),
    records.countPartHistory(record.id),
  ]);
  const partsWithHistory = [...new Set(history.map((h) => h.partId))];
  return { record, partProgress, partsWithHistory, partHistoryCount };
}
