import {
  type ActivityRecord,
  type ActivityRecordId,
  DomainError,
  type UserId,
} from "@hearth/domain";
import { canOverrideActivityRecordVisibility } from "@hearth/domain/policy/can-override-activity-record-visibility";
import type { VisibilityPreference } from "@hearth/domain/visibility";
import type { ActivityRecordRepository, Clock, UserRepository } from "@hearth/ports";

export type SetRecordVisibilityOverrideInput = {
  readonly actor: UserId;
  readonly recordId: ActivityRecordId;
  readonly override: VisibilityPreference | null;
};

export type SetRecordVisibilityOverrideDeps = {
  readonly users: UserRepository;
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * Set (or clear, with `null`) the per-record Visibility override. Only the
 * participant may change their own record's audience preference — the
 * ownership check is the gate here, since `recordId` is caller-supplied and
 * a forged id must not let one participant adjust another's visibility.
 */
export async function setRecordVisibilityOverride(
  input: SetRecordVisibilityOverrideInput,
  deps: SetRecordVisibilityOverrideDeps,
): Promise<ActivityRecord> {
  const record = await deps.records.byId(input.recordId);
  if (!record) {
    throw new DomainError("NOT_FOUND", "Record not found.", "record_not_found");
  }
  const actor = await deps.users.byId(input.actor);
  if (!actor) {
    throw new DomainError("NOT_FOUND", "Record not found.", "record_not_found");
  }

  const verdict = canOverrideActivityRecordVisibility(actor, record);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.records.setVisibilityOverride({
    id: input.recordId,
    override: input.override,
    now: deps.clock.now(),
  });
}
