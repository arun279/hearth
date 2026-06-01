import {
  type ActivityPartId,
  initialPartProgressState,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import {
  type LoadWritableOwnPartDeps,
  loadWritableOwnPart,
} from "./_lib/load-own-record-context.ts";

export type SetPartCompletedInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly partId: string;
  readonly completed: boolean;
};

export type SetPartCompletedResult = {
  readonly partId: string;
  readonly completed: boolean;
};

export type SetPartCompletedDeps = LoadWritableOwnPartDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * Toggle the honor-system "I finished this Part" flag. Own-record only, any
 * Part kind. The flag is purely self-reported — no `minWords` / quiz-score
 * gate stands between the participant and marking a Part done. Read-modify-
 * write over the existing PartProgress so the Part's working value (reflection
 * prose, quiz answers, resume cursor) is preserved while only `completed`
 * changes; a freshly-touched Part falls back to `initialPartProgressState`.
 */
export async function setPartCompleted(
  input: SetPartCompletedInput,
  deps: SetPartCompletedDeps,
): Promise<SetPartCompletedResult> {
  const part = await loadWritableOwnPart(
    { actor: input.actor, activityId: input.activityId, partId: input.partId },
    undefined,
    deps,
  );

  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
  });
  const existing = await deps.records.getPartProgress({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
  });
  const base = existing?.state ?? initialPartProgressState(part);
  // TODO(m11): this read-modify-write carries `base`'s working value (e.g. a
  // reflection's `text`) back with the `completed` flip. If the participant
  // toggles complete while an autosave is still in flight, the completion write
  // can land the last-persisted (stale) text over newer prose. M11 owns
  // ActivityRecord/PartProgress durability — fold completion into a targeted
  // write there (or have the player flush the pending autosave first). See the
  // docs/tripwires.md "completion toggle clobbers in-flight reflection" entry.
  await deps.records.savePartProgress({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
    state: { ...base, completed: input.completed },
  });

  return { partId: part.id, completed: input.completed };
}
