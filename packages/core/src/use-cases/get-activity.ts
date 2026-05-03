import type { LearningActivity, LearningActivityId, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

export type GetActivityInput = {
  readonly actor: UserId;
  readonly id: LearningActivityId;
};

export type GetActivityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Aggregate read for the activity-detail surface. Viewability is gated
 * through `loadViewableActivity`; full visibility-scope projection
 * (per-record `summary` vs `full`) is M12's responsibility — M8 ships
 * the full envelope to authority and enrolled viewers; non-viewers
 * receive `NOT_FOUND` from the loader.
 */
export async function getActivity(
  input: GetActivityInput,
  deps: GetActivityDeps,
): Promise<LearningActivity> {
  const { activity } = await loadViewableActivity(input.actor, input.id, deps);
  return activity;
}
