import type { LearningActivityListItem, LearningTrackId, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type ListTrackActivitiesInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type ListTrackActivitiesDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * List the activities on a track, projected for the Activities tab.
 * Track viewability is enforced via `loadViewableTrack`; the adapter
 * filters out rows whose `accessState` resolves to `hidden` for the
 * viewer (M12's full visibility computation lights up here when the
 * milestone lands).
 */
export async function listTrackActivities(
  input: ListTrackActivitiesInput,
  deps: ListTrackActivitiesDeps,
): Promise<readonly LearningActivityListItem[]> {
  await loadViewableTrack(input.actor, input.trackId, deps);
  return deps.activities.byTrack(input.trackId);
}
