import {
  type ActivityRecord,
  computeActivityAccessState,
  DomainError,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import { canMarkActivityComplete } from "@hearth/domain/policy/can-mark-activity-complete";
import type {
  ActivityRecordRepository,
  Clock,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

export type MarkActivityCompleteInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
};

export type MarkActivityCompleteDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * Mark the participant's own Activity Record complete. Under `manual_mark`
 * the participant completes it directly on the honor system; under
 * `all_parts_complete` the record can only be completed once every Part has
 * a completed progress row. The open-window + ownership gates live in
 * `canMarkActivityComplete`.
 */
export async function markActivityComplete(
  input: MarkActivityCompleteInput,
  deps: MarkActivityCompleteDeps,
): Promise<ActivityRecord> {
  const ctx = await loadViewableActivity(input.actor, input.activityId, deps);
  const now = deps.clock.now();
  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
    now,
  });

  const progress = await deps.records.listPartProgress(record.id);
  const completedPartIds = new Set<string>(
    progress.filter((p) => p.state.completed).map((p) => p.partId),
  );
  const allPartsComplete = ctx.activity.parts.every((p) => completedPartIds.has(p.id));
  const accessState = computeActivityAccessState(
    ctx.activity.window,
    ctx.activity.postClosePolicy,
    now,
  );

  const verdict = canMarkActivityComplete(
    ctx.actor,
    record,
    ctx.activity.completionRule,
    accessState,
    allPartsComplete,
  );
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.records.setCompletion({ id: record.id, state: "completed", at: now });
}
