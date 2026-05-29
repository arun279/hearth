import {
  computeActivityAccessState,
  type LearningActivityListItem,
  type LearningTrackId,
  type UserId,
} from "@hearth/domain";
import type {
  Clock,
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
  readonly clock: Clock;
};

/**
 * List the activities on a track, projected for the Activities tab.
 * Track viewability is enforced via `loadViewableTrack`. Activities
 * whose access state computes to `hidden` (post-close `hidden` policy
 * past `closesAt`) are filtered out at the use case layer rather than
 * the adapter — the adapter is viewer-agnostic and has no clock; the
 * use case owns "what this viewer sees, right now."
 *
 * Filtering at the list layer is load-bearing: returning a hidden row
 * would leak its existence (a click leads to 404 at /player; the row
 * itself would advertise the title). The list and the detail route
 * must agree on visibility — if /player would 404 the activity, the
 * list must omit it.
 */
export async function listTrackActivities(
  input: ListTrackActivitiesInput,
  deps: ListTrackActivitiesDeps,
): Promise<readonly LearningActivityListItem[]> {
  await loadViewableTrack(input.actor, input.trackId, deps);
  const rows = await deps.activities.byTrack(input.trackId);
  const now = deps.clock.now();
  return rows.filter(
    (row) => computeActivityAccessState(row.window, row.postClosePolicy, now) !== "hidden",
  );
}
