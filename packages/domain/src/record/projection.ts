import type { ActivityPartId } from "../ids.ts";
import type { ActivityRecord, PartProgress } from "./types.ts";

/**
 * The full read projection of an Activity Record — what a participant sees
 * of their own record, and (post-M12) what a `full`-scope viewer sees of
 * another participant's. Carries the record metadata, every Part's current
 * progress, and two history rollups so the SPA renders the "N prior
 * attempts preserved" chip and the per-Part history affordance without a
 * follow-up GET:
 *
 * - `partHistoryCount` — total `PartHistory` rows across all Parts.
 * - `partsWithHistory` — the Part ids that have at least one history row,
 *   so the SPA shows the per-Part drawer trigger only where it would open
 *   to something.
 *
 * M12 layers `summary` / `hidden` shapers alongside this; M11 returns
 * `full` only.
 */
export type ActivityRecordFullView = {
  readonly id: ActivityRecord["id"];
  readonly activityId: ActivityRecord["activityId"];
  readonly participantId: ActivityRecord["participantId"];
  readonly completionState: ActivityRecord["completionState"];
  readonly completedAt: ActivityRecord["completedAt"];
  readonly visibilityOverride: ActivityRecord["visibilityOverride"];
  readonly createdAt: ActivityRecord["createdAt"];
  readonly updatedAt: ActivityRecord["updatedAt"];
  readonly parts: ReadonlyArray<{
    readonly partId: PartProgress["partId"];
    readonly state: PartProgress["state"];
    readonly updatedAt: PartProgress["updatedAt"];
  }>;
  readonly partHistoryCount: number;
  readonly partsWithHistory: readonly ActivityPartId[];
};

/**
 * Pure shaper for `ActivityRecordFullView`. The adapter supplies the row
 * data (record + progress) and the precomputed history aggregates
 * (`partHistoryCount` from one `COUNT(*)`, `partsWithHistory` from a
 * `SELECT DISTINCT partId`); this function only assembles the wire shape so
 * the projection logic lives in one tested place rather than re-derived per
 * read path.
 */
export function projectRecordFull(args: {
  readonly record: ActivityRecord;
  readonly progress: readonly PartProgress[];
  readonly partHistoryCount: number;
  readonly partsWithHistory: readonly ActivityPartId[];
}): ActivityRecordFullView {
  const { record, progress, partHistoryCount, partsWithHistory } = args;
  return {
    id: record.id,
    activityId: record.activityId,
    participantId: record.participantId,
    completionState: record.completionState,
    completedAt: record.completedAt,
    visibilityOverride: record.visibilityOverride,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    parts: progress.map((p) => ({
      partId: p.partId,
      state: p.state,
      updatedAt: p.updatedAt,
    })),
    partHistoryCount,
    partsWithHistory,
  };
}
