import {
  type ActivityPartId,
  type ActivityRecord,
  computeActivityAccessState,
  DomainError,
  initialPartProgressState,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import { canMarkPartComplete } from "@hearth/domain/policy/record";
import type { ActivityRecordRepository, Clock } from "@hearth/ports";
import { assertActivityWritable } from "./_lib/assert-activity-writable.ts";
import {
  assertParticipant,
  type LoadOwnRecordDeps,
  loadOwnRecordContext,
} from "./_lib/load-own-record-context.ts";
import { allPartsComplete, hardPrereqsMet } from "./_lib/record-completion.ts";
import { completeRecord } from "./mark-activity-complete.ts";

export type SetPartCompletedInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly partId: string;
  readonly completed: boolean;
};

export type SetPartCompletedResult = {
  readonly partId: string;
  readonly completed: boolean;
  /** Present iff this call transitioned the activity to `completed` (the
   * `all_parts_complete` rule fired on the last Part) so the SPA flips the
   * chrome without a follow-up GET. */
  readonly record?: ActivityRecord;
};

export type SetPartCompletedDeps = LoadOwnRecordDeps & {
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * Toggle the honor-system "I finished this Part" flag. Own-record only, any
 * Part kind. Self-reported — the only gates are ownership, a closed window,
 * and (on a complete) an unmet hard prerequisite.
 *
 * The flip is a TARGETED write (`setPartCompletion`) that patches only the
 * `completed` flag on whatever progress is currently persisted, never a
 * read-modify-write of the whole envelope. That is what structurally
 * eliminates the clobber window: a learner who marks a Part complete while a
 * reflection autosave is still in flight cannot lose the in-flight prose,
 * because this write never carries the value back.
 *
 * When completing under the `all_parts_complete` Completion Rule and every
 * Part is now marked done, the activity auto-completes inline and the
 * resulting record rides back in `result.record`.
 */
export async function setPartCompleted(
  input: SetPartCompletedInput,
  deps: SetPartCompletedDeps,
): Promise<SetPartCompletedResult> {
  const ctx = await loadOwnRecordContext(input.actor, input.activityId, deps);
  assertParticipant(ctx);
  const now = deps.clock.now();
  assertActivityWritable(ctx.activity, now);

  const part = ctx.activity.parts.find((p) => p.id === input.partId);
  if (!part) {
    throw new DomainError("NOT_FOUND", "Part not found.", "not_found");
  }

  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
  });

  if (input.completed) {
    const accessState = computeActivityAccessState(
      ctx.activity.window,
      ctx.activity.postClosePolicy,
      now,
    );
    const progress = await deps.records.listPartProgress(record.id);
    const completedPartIds = new Set(
      progress.filter((p) => p.state.completed).map((p) => p.partId as string),
    );
    const verdict = canMarkPartComplete(
      ctx.actor,
      record,
      hardPrereqsMet(ctx.activity, part.id, completedPartIds),
      accessState,
    );
    if (!verdict.ok) {
      throw new DomainError("CONFLICT", verdict.reason.message, verdict.reason.code);
    }
  }

  await deps.records.setPartCompletion({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
    completed: input.completed,
    initialState: initialPartProgressState(part),
  });

  if (
    input.completed &&
    ctx.activity.completionRule.kind === "all_parts_complete" &&
    record.completionState !== "completed" &&
    (await allPartsComplete(record.id, ctx.activity, deps.records))
  ) {
    const completed = await completeRecord(ctx.actor, record, ctx.activity, deps);
    return { partId: part.id, completed: input.completed, record: completed };
  }

  return { partId: part.id, completed: input.completed };
}
