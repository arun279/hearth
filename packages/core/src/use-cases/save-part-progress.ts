import {
  type ActivityPartId,
  type ActivityRecord,
  DomainError,
  type LearningActivityId,
  type PartProgress,
  type PartProgressState,
  type UserId,
} from "@hearth/domain";
import type {
  ActivityRecordRepository,
  Clock,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { assertWritablePart } from "./_lib/assert-writable-part.ts";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

export type SavePartProgressInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly partId: ActivityPartId;
  readonly state: PartProgressState;
};

export type SavePartProgressDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

export type SavePartProgressResult = {
  readonly partProgress: PartProgress;
  readonly record: ActivityRecord;
};

/**
 * Save one Part's progress on the participant's own record. The honor-system
 * `completed` flag gates on `canMarkPartComplete` — record ownership, an open
 * window, and met hard prerequisites — so a non-route caller can't forge a
 * completion past a locked window or an unmet prereq.
 *
 * When this save flips a Part from incomplete to complete and the activity's
 * completion rule is `all_parts_complete`, the record auto-completes the moment
 * the last Part lands — a participant never has to separately "finish" an
 * activity whose every Part they've already done.
 */
export async function savePartProgress(
  input: SavePartProgressInput,
  deps: SavePartProgressDeps,
): Promise<SavePartProgressResult> {
  const ctx = await loadViewableActivity(input.actor, input.activityId, deps);
  const part = ctx.activity.parts.find((p) => p.id === input.partId);
  if (!part) {
    throw new DomainError("NOT_FOUND", "Part not found on this activity.", "part_not_found");
  }

  const { record, now, priorProgress, completedOtherPartIds } = await assertWritablePart(
    ctx,
    input.actor,
    input.partId,
    deps,
  );

  const priorThisPart = priorProgress.find((p) => p.partId === input.partId);
  const justCompleted = !(priorThisPart?.state.completed ?? false) && input.state.completed;

  const partProgress = await deps.records.savePartProgress({
    activityRecordId: record.id,
    partId: input.partId,
    state: input.state,
    now,
  });

  if (
    justCompleted &&
    ctx.activity.completionRule.kind === "all_parts_complete" &&
    record.completionState !== "completed"
  ) {
    const completedIds = new Set(completedOtherPartIds);
    completedIds.add(input.partId);
    const allComplete = ctx.activity.parts.every((p) => completedIds.has(p.id));
    if (allComplete) {
      const completed = await deps.records.setCompletion({
        id: record.id,
        state: "completed",
        at: now,
      });
      return { partProgress, record: completed };
    }
  }

  return { partProgress, record };
}
