import {
  type ActivityRecord,
  computeActivityAccessState,
  DomainError,
  type LearningActivity,
  type LearningActivityId,
  type User,
  type UserId,
} from "@hearth/domain";
import { canMarkActivityComplete } from "@hearth/domain/policy/record";
import type { ActivityRecordRepository, Clock } from "@hearth/ports";
import { type LoadOwnRecordDeps, loadOwnRecordContext } from "./_lib/load-own-record-context.ts";
import { allPartsComplete } from "./_lib/record-completion.ts";

export type MarkActivityCompleteInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
};

export type MarkActivityCompleteDeps = LoadOwnRecordDeps & {
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * Mark the actor's own activity record complete. Under `all_parts_complete`
 * every Part must already be marked done; under `manual_mark` (the v1
 * default) the participant completes at will. Idempotent: a record that is
 * already `completed` is returned unchanged without a second write.
 */
export async function markActivityComplete(
  input: MarkActivityCompleteInput,
  deps: MarkActivityCompleteDeps,
): Promise<ActivityRecord> {
  const ctx = await loadOwnRecordContext(input.actor, input.activityId, deps);
  if (!ctx.participation.ok) {
    throw new DomainError(
      "FORBIDDEN",
      ctx.participation.reason.message,
      ctx.participation.reason.code,
    );
  }

  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
  });

  return completeRecord(ctx.actor, record, ctx.activity, deps);
}

/**
 * Shared completion step, reused by `mark-activity-complete` (explicit
 * complete) and `set-part-completed` (inline auto-complete on the last
 * Part). Runs the policy gate, no-ops when already complete, otherwise
 * writes the rollup with `completedAt = clock.now()` and returns the
 * resulting record. The caller has already loaded `record` + `activity`
 * and authorized the actor as a participant.
 *
 * `allPartsAlreadyVerified` lets a caller that has just proven every Part is
 * complete against the post-write state skip the redundant `listPartProgress`
 * re-read here. `set-part-completed` passes it; `markActivityComplete` does
 * not (it has not proven completion), so the default keeps the live check.
 */
export async function completeRecord(
  actor: User,
  record: ActivityRecord,
  activity: LearningActivity,
  deps: { readonly records: ActivityRecordRepository; readonly clock: Clock },
  allPartsAlreadyVerified = false,
): Promise<ActivityRecord> {
  if (record.completionState === "completed") return record;

  const now = deps.clock.now();
  const accessState = computeActivityAccessState(activity.window, activity.postClosePolicy, now);
  const allComplete =
    activity.completionRule.kind === "manual_mark" || allPartsAlreadyVerified
      ? true
      : await allPartsComplete(record.id, activity, deps.records);

  const verdict = canMarkActivityComplete(actor, record, allComplete, accessState);
  if (!verdict.ok) {
    throw new DomainError("CONFLICT", verdict.reason.message, verdict.reason.code);
  }

  await deps.records.setCompletion({ id: record.id, state: "completed", at: now });
  return { ...record, completionState: "completed", completedAt: now };
}
