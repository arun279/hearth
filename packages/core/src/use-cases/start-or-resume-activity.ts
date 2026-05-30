import type { LearningActivityId, UserId } from "@hearth/domain";
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

export type StartOrResumeActivityInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
};

export type StartOrResumeActivityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

/**
 * Open the participant's own Activity Record, creating it on first visit.
 * Gated by track viewability (404 on a non-viewer per the existence-leak
 * rule); a viewer who can see the activity always has a record they own,
 * so `upsert` is unconditional. Returns the resume view the player mounts
 * against: the record, every Part's progress, and the history fan-out.
 */
export async function startOrResumeActivity(
  input: StartOrResumeActivityInput,
  deps: StartOrResumeActivityDeps,
): Promise<ActivityRecordView> {
  await loadViewableActivity(input.actor, input.activityId, deps);
  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
    now: deps.clock.now(),
  });
  return loadRecordView(record, deps.records);
}
