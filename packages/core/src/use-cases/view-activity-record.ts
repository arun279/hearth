import {
  type ActivityRecordId,
  DomainError,
  type FullActivityRecord,
  projectActivityRecord,
  type SummaryActivityRecord,
  type UserId,
} from "@hearth/domain";
import { type LoadViewableRecordDeps, loadViewableRecord } from "./_lib/load-viewable-record.ts";
import { memberDisplayName } from "./_lib/member-display-name.ts";

export type ViewActivityRecordInput = {
  readonly actor: UserId;
  readonly recordId: ActivityRecordId;
};

export type ViewActivityRecordDeps = LoadViewableRecordDeps;

/**
 * Read one Activity Record by its id — the recordId-addressed,
 * cross-participant read surface. The scope the actor resolves drives the
 * shape returned:
 *
 * - `full` — the participant themselves, or a track authority, or a peer the
 *   participant's preference grants full to: the complete projection plus the
 *   two history rollups (`partHistoryCount`, `partsWithHistory`) so the SPA
 *   renders the "N prior attempts preserved" chip and per-Part history
 *   affordance without a follow-up GET.
 * - `summary` — a track-peer (or an in-group non-enrollee) the preference
 *   redacts to existence-and-completion facts only, no working state.
 *
 * Composition is handled inside `loadViewableRecord`: the access gate runs
 * first (deny -> 404), then the visibility resolver (hidden -> 404). A
 * view-denied or hidden read is therefore byte-identical to a
 * missing row — the record id is not an enumeration oracle over a hideable
 * resource.
 */
export async function viewActivityRecord(
  input: ViewActivityRecordInput,
  deps: ViewActivityRecordDeps,
): Promise<FullActivityRecord | SummaryActivityRecord> {
  const ctx = await loadViewableRecord(input.actor, input.recordId, deps);
  const participantDisplayName = memberDisplayName(ctx.participant, ctx.participantMembership);

  if (ctx.scope === "summary") {
    const projected = projectActivityRecord("summary", {
      record: ctx.record,
      progress: [],
      partHistoryCount: 0,
      partsWithHistory: [],
      participantDisplayName,
    });
    // `summary` never projects to null; the union keeps the projector honest.
    if (!projected) throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
    return projected;
  }

  const [progress, partHistoryCount, partsWithHistory] = await Promise.all([
    deps.records.listPartProgress(ctx.record.id),
    deps.records.countPartHistory(ctx.record.id),
    deps.records.partsWithHistory(ctx.record.id),
  ]);

  const projected = projectActivityRecord("full", {
    record: ctx.record,
    progress,
    partHistoryCount,
    partsWithHistory,
    participantDisplayName,
  });
  if (!projected) throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  return projected;
}
