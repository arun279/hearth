import type { ActivityPartId } from "../ids.ts";
import { type ActivityRecordFullView, projectRecordFull } from "../record/projection.ts";
import type { ActivityRecord, PartProgress } from "../record/types.ts";
import type { VisibilityScope } from "./preference.ts";

/**
 * The redacted wire shape a `summary`-scope viewer sees of another
 * participant's record: only the existence-and-completion facts, never any
 * working state. Deliberately a *distinct* type (not a subset of
 * {@link ActivityRecordFullView}) so the absence of part values, part
 * history, reflection text, quiz answers, and the visibility override is
 * structural — they cannot leak through an accidental spread.
 */
export type SummaryActivityRecord = {
  readonly scope: "summary";
  readonly recordId: ActivityRecord["id"];
  readonly activityId: ActivityRecord["activityId"];
  readonly participantId: ActivityRecord["participantId"];
  readonly participantDisplayName: string;
  readonly completionState: ActivityRecord["completionState"];
  readonly completedAt: ActivityRecord["completedAt"];
};

/**
 * The `full`-scope wire shape: the existing {@link ActivityRecordFullView}
 * wrapped with the scope discriminant and the viewer-resolved display name,
 * rather than a duplicated field list — so the full read projection lives in
 * exactly one place.
 */
export type FullActivityRecord = ActivityRecordFullView & {
  readonly scope: "full";
  readonly participantDisplayName: string;
};

/**
 * Project a record into its scope-appropriate wire shape. Pure: the caller
 * resolves `participantDisplayName` (via the M3 display-name chain) and the
 * history aggregates, and supplies the `scope` from
 * `resolveActivityRecordScope`. Returns `null` for `hidden`, which the use
 * case maps to a 404 (byte-identical to a missing row).
 */
export function projectActivityRecord(
  scope: VisibilityScope,
  args: {
    readonly record: ActivityRecord;
    readonly progress: readonly PartProgress[];
    readonly partHistoryCount: number;
    readonly partsWithHistory: readonly ActivityPartId[];
    readonly participantDisplayName: string;
  },
): FullActivityRecord | SummaryActivityRecord | null {
  if (scope === "hidden") return null;

  if (scope === "summary") {
    return {
      scope: "summary",
      recordId: args.record.id,
      activityId: args.record.activityId,
      participantId: args.record.participantId,
      participantDisplayName: args.participantDisplayName,
      completionState: args.record.completionState,
      completedAt: args.record.completedAt,
    };
  }

  return {
    scope: "full",
    participantDisplayName: args.participantDisplayName,
    ...projectRecordFull({
      record: args.record,
      progress: args.progress,
      partHistoryCount: args.partHistoryCount,
      partsWithHistory: args.partsWithHistory,
    }),
  };
}
