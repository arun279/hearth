import {
  type ActivityRecordFullView,
  type ActivityRecordId,
  DomainError,
  projectRecordFull,
  type UserId,
} from "@hearth/domain";
import { canViewActivityRecord } from "@hearth/domain/policy/record";
import type { ActivityRecordRepository, UserRepository } from "@hearth/ports";

export type ViewActivityRecordInput = {
  readonly actor: UserId;
  readonly recordId: ActivityRecordId;
};

export type ViewActivityRecordDeps = {
  readonly users: UserRepository;
  readonly records: ActivityRecordRepository;
};

/**
 * Read a full Activity Record by its id — the recordId-addressed,
 * cross-participant read surface (a facilitator inspecting a participant's
 * work, or a participant reading their own via the record id). Returns the
 * full projection plus the two history rollups (`partHistoryCount`,
 * `partsWithHistory`) so the SPA renders the "N prior attempts preserved"
 * chip and the per-Part history affordance without a follow-up GET.
 *
 * Viewability-before-authorization: a view-denied actor gets `NOT_FOUND`
 * (404), NOT `FORBIDDEN` (403), so a non-participant probing a record id
 * cannot distinguish "exists but forbidden" from "does not exist" — the
 * recordId read over a hideable resource is otherwise an enumeration oracle.
 * M11 grants only the participant themselves (`scope = "full"`); M12 widens
 * to track viewers with `summary` / `hidden` without changing this signature.
 */
export async function viewActivityRecord(
  input: ViewActivityRecordInput,
  deps: ViewActivityRecordDeps,
): Promise<ActivityRecordFullView> {
  const actor = await deps.users.byId(input.actor);
  if (!actor) {
    throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  }
  const record = await deps.records.byId(input.recordId);
  if (!record) {
    throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  }

  const view = canViewActivityRecord(actor, record);
  if (!view.ok) {
    throw new DomainError("NOT_FOUND", "Record not found.", "not_found");
  }

  const [progress, partHistoryCount, history] = await Promise.all([
    deps.records.listPartProgress(record.id),
    deps.records.countPartHistory(record.id),
    deps.records.listPartHistory(record.id),
  ]);
  const partsWithHistory = [...new Set(history.map((h) => h.partId))];

  return projectRecordFull({ record, progress, partHistoryCount, partsWithHistory });
}
