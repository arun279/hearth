import {
  type ActivityPartId,
  type ActivityRecordFullView,
  DomainError,
  type LearningActivityId,
  projectRecordFull,
  type UserId,
} from "@hearth/domain";
import { isAuthorityOverTrack } from "@hearth/domain/policy/is-authority-over-track";
import { canResetParticipantProgress } from "@hearth/domain/policy/record";
import type { ActivityRecordRepository, Clock } from "@hearth/ports";
import {
  type LoadViewableActivityDeps,
  loadViewableActivity,
} from "./_lib/load-viewable-activity.ts";

export type ResetParticipantProgressInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
};

export type ResetParticipantProgressDeps = LoadViewableActivityDeps & {
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * A Track Facilitator (or Group Admin) resets a participant's progress on an
 * activity. Destructive in a non-obvious way: the participant KEEPS their work
 * as Part History — every current Part value is archived (`reason =
 * facilitator_reset`) and reset to its kind-appropriate empty state in one
 * D1 batch via `reopenAgainstRevision`. Addressed by activity + participant
 * (not record id), so the facilitator never needs to hold the record id.
 *
 * A completed record is also returned to `in_progress` (clearing `completedAt`):
 * a reset that cleared every Part but left the activity flagged complete is
 * incoherent — under `manual_mark` the participant can no longer re-complete,
 * and under `all_parts_complete` the auto-complete cannot re-fire. Resetting
 * the rollup is what makes the cleared state a genuine fresh start.
 *
 * Returns the now-reset full record view so the facilitator's surface updates
 * without a refetch. A no-op (the participant never started) is a `NOT_FOUND`
 * rather than a silent success — there is nothing to reset.
 */
export async function resetParticipantProgress(
  input: ResetParticipantProgressInput,
  deps: ResetParticipantProgressDeps,
): Promise<ActivityRecordFullView> {
  const ctx = await loadViewableActivity(input.actor, input.activityId, deps);
  const verdict = canResetParticipantProgress(
    isAuthorityOverTrack(ctx.track, ctx.groupMembership, ctx.trackEnrollment),
  );
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const record = await deps.records.byParticipantAndActivity(input.activityId, input.participantId);
  if (!record) {
    throw new DomainError("NOT_FOUND", "This participant has no progress to reset.", "not_found");
  }

  const allPartIds = ctx.activity.parts.map((p) => p.id as ActivityPartId);
  await deps.records.reopenAgainstRevision({
    recordId: record.id,
    newRevisionId: null,
    affectedPartIds: allPartIds,
    reason: "facilitator_reset",
  });

  let resetRecord = record;
  if (record.completionState === "completed") {
    const now = deps.clock.now();
    await deps.records.setCompletion({ id: record.id, state: "in_progress", at: now });
    resetRecord = { ...record, completionState: "in_progress", completedAt: null, updatedAt: now };
  }

  const [progress, partHistoryCount, partsWithHistory] = await Promise.all([
    deps.records.listPartProgress(resetRecord.id),
    deps.records.countPartHistory(resetRecord.id),
    deps.records.partsWithHistory(resetRecord.id),
  ]);
  return projectRecordFull({
    record: resetRecord,
    progress,
    partHistoryCount,
    partsWithHistory,
  });
}
