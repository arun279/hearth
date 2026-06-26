import {
  type ActivityPartId,
  type ActivityRecordId,
  DomainError,
  type PartHistory,
  type UserId,
} from "@hearth/domain";
import { type LoadViewableRecordDeps, loadViewableRecord } from "./_lib/load-viewable-record.ts";

export type ListPartHistoryInput = {
  readonly actor: UserId;
  readonly recordId: ActivityRecordId;
  /** Narrow to one Part; omit to list every Part's history for the record. */
  readonly partId?: ActivityPartId;
};

export type ListPartHistoryDeps = LoadViewableRecordDeps;

/**
 * List the append-only `PartHistory` entries for a record — what the
 * `<PartHistoryDrawer>` renders when opened from a Part with prior attempts.
 * recordId-addressed and gated by the SAME scope resolution as
 * `view-activity-record`: a view-denied or hidden actor gets `NOT_FOUND`, and
 * a viewer redacted to `summary` is treated identically (history is full
 * working state — a `summary` viewer sees no Part values, so it must not leak
 * their history either). Only a `full`-scope viewer receives the entries.
 */
export async function listPartHistory(
  input: ListPartHistoryInput,
  deps: ListPartHistoryDeps,
): Promise<readonly PartHistory[]> {
  const ctx = await loadViewableRecord(input.actor, input.recordId, deps);
  if (ctx.scope !== "full") {
    throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  }
  return deps.records.listPartHistory(ctx.record.id, { partId: input.partId });
}
