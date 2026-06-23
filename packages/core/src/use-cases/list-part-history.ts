import {
  type ActivityPartId,
  type ActivityRecordId,
  DomainError,
  type PartHistory,
  type UserId,
} from "@hearth/domain";
import { canViewActivityRecord } from "@hearth/domain/policy/record";
import type { ActivityRecordRepository, UserRepository } from "@hearth/ports";

export type ListPartHistoryInput = {
  readonly actor: UserId;
  readonly recordId: ActivityRecordId;
  /** Narrow to one Part; omit to list every Part's history for the record. */
  readonly partId?: ActivityPartId;
};

export type ListPartHistoryDeps = {
  readonly users: UserRepository;
  readonly records: ActivityRecordRepository;
};

/**
 * List the append-only `PartHistory` entries for a record — what the
 * `<PartHistoryDrawer>` renders when opened from a Part with prior attempts.
 * recordId-addressed and gated by the same viewability→404 rule as
 * `view-activity-record` (a view-denied actor gets `NOT_FOUND`, never a 403,
 * so the record id is not an enumeration oracle).
 */
export async function listPartHistory(
  input: ListPartHistoryInput,
  deps: ListPartHistoryDeps,
): Promise<readonly PartHistory[]> {
  const actor = await deps.users.byId(input.actor);
  if (!actor) {
    throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  }
  const record = await deps.records.byId(input.recordId);
  if (!record) {
    throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  }
  if (!canViewActivityRecord(actor, record).ok) {
    throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  }

  return deps.records.listPartHistory(record.id, { partId: input.partId });
}
