import type { LearningActivityListItem, LearningTrackId, UserId } from "@hearth/domain";
import {
  type LoadVisibleActivitiesForTrackDeps,
  loadVisibleActivitiesForTrack,
} from "./_lib/load-visible-activities-for-track.ts";

export type ListTrackActivitiesInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type ListTrackActivitiesDeps = LoadVisibleActivitiesForTrackDeps;

/**
 * Project the activities on a track for the Activities tab. The
 * visibility decision is delegated to `loadVisibleActivitiesForTrack`,
 * which is the same predicate the `/player` route reaches for —
 * keeping the list and the detail surface in lockstep so a row never
 * advertises an activity the viewer cannot open.
 */
export async function listTrackActivities(
  input: ListTrackActivitiesInput,
  deps: ListTrackActivitiesDeps,
): Promise<readonly LearningActivityListItem[]> {
  return loadVisibleActivitiesForTrack(input.actor, input.trackId, deps);
}
