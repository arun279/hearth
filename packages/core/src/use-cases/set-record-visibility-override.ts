import type { LearningActivityId, UserId, VisibilityPreference } from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import {
  assertParticipant,
  type LoadOwnRecordDeps,
  loadOwnRecordContext,
} from "./_lib/load-own-record-context.ts";

export type SetRecordVisibilityOverrideInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  /** `null` clears the override, reverting to the user's default preference. */
  readonly preference: VisibilityPreference | null;
};

export type SetRecordVisibilityOverrideDeps = LoadOwnRecordDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * Set (or clear) the record-level visibility override. Own-record only. No
 * window/accessState gate — a participant may change who sees their work at
 * any time, including after the activity closes. The override is record-
 * scoped even though the SPA surfaces it next to the reflection Part.
 */
export async function setRecordVisibilityOverride(
  input: SetRecordVisibilityOverrideInput,
  deps: SetRecordVisibilityOverrideDeps,
): Promise<{ readonly visibilityOverride: VisibilityPreference | null }> {
  const ctx = await loadOwnRecordContext(input.actor, input.activityId, deps);
  assertParticipant(ctx);
  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
  });
  await deps.records.setVisibilityOverride(record.id, input.preference);
  return { visibilityOverride: input.preference };
}
