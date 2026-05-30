import {
  type ActivityPartId,
  DomainError,
  initialPartProgressState,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import { canResetParticipantProgress } from "@hearth/domain/policy/can-reset-participant-progress";
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
import { type ActivityRecordView, loadRecordView } from "./_lib/record-view.ts";

export type ResetParticipantProgressInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
};

export type ResetParticipantProgressDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * Reset a participant's progress on an activity — a Track-authority action
 * (Group Admin or Track Facilitator). The participant's work is never
 * destroyed: `reopenAgainstRevision` snapshots every Part's current progress
 * into Part History (`facilitator_reset`) before resetting it to the empty
 * state. Returns the freshly-reset record view.
 */
export async function resetParticipantProgress(
  input: ResetParticipantProgressInput,
  deps: ResetParticipantProgressDeps,
): Promise<ActivityRecordView> {
  const ctx = await loadViewableActivity(input.actor, input.activityId, deps);

  const verdict = canResetParticipantProgress(
    ctx.actor,
    ctx.group,
    ctx.track,
    ctx.groupMembership,
    ctx.trackEnrollment,
  );
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const target = await deps.records.byParticipantAndActivity({
    activityId: input.activityId,
    participantId: input.participantId,
  });
  if (!target) {
    throw new DomainError(
      "NOT_FOUND",
      "This participant has no record for the activity.",
      "record_not_found",
    );
  }

  const now = deps.clock.now();
  await deps.records.reopenAgainstRevision({
    recordId: target.id,
    reason: "facilitator_reset",
    revisionIdAtTime: null,
    resets: ctx.activity.parts.map((p) => ({
      partId: p.id as ActivityPartId,
      resetState: initialPartProgressState(p),
    })),
    now,
  });

  const reset = await deps.records.byId(target.id);
  if (!reset) {
    throw new DomainError("NOT_FOUND", "Record not found.", "record_not_found");
  }
  return loadRecordView(reset, deps.records);
}
