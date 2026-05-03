import {
  DomainError,
  type LearningActivity,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack, type ViewableTrackContext } from "./load-viewable-track.ts";

export type ViewableActivityContext = ViewableTrackContext & {
  readonly activity: LearningActivity;
};

export type LoadViewableActivityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Load a Learning Activity gated by track viewability. Mirrors
 * `loadViewableTrack` so existence is never leaked: a non-viewer of the
 * parent group sees the same `NOT_FOUND` whether the activity exists
 * or not.
 *
 * The returned context bundles every field the activity-mutating use
 * cases need — actor, group, track, group membership, track enrollment,
 * and the activity itself. Authorization is the caller's
 * responsibility (they must run the relevant policy predicate next).
 */
export async function loadViewableActivity(
  actorId: UserId,
  activityId: LearningActivityId,
  deps: LoadViewableActivityDeps,
): Promise<ViewableActivityContext> {
  const activity = await deps.activities.byId(activityId);
  if (!activity) {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }
  const trackContext = await loadViewableTrack(actorId, activity.trackId, deps);
  // Defense against a port-fake that returns a row whose trackId doesn't
  // match what `byTrack` would have keyed against — collapse to NOT_FOUND
  // so the enumeration-oracle protection mirrors `loadViewableTrack`.
  if (activity.trackId !== trackContext.track.id) {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }
  return { ...trackContext, activity };
}
