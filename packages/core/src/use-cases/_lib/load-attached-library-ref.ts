import {
  DomainError,
  type LearningActivity,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import { canPinLibraryRevision } from "@hearth/domain/policy/can-pin-library-revision";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./load-viewable-activity.ts";

export type LoadAttachedLibraryRefDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Shared shape used by `pin-library-revision` and
 * `unpin-library-revision`: load the activity (gated by viewability),
 * run the edit-policy gate, and confirm the named library item is
 * already attached. The two callers diverge only in how they transform
 * the existing ref set, so factor everything before the transform here.
 */
export async function loadAttachedLibraryRef(
  actor: UserId,
  activityId: LearningActivityId,
  libraryItemId: string,
  deps: LoadAttachedLibraryRefDeps,
): Promise<LearningActivity> {
  const {
    actor: actorUser,
    group,
    track,
    groupMembership,
    trackEnrollment,
    activity,
  } = await loadViewableActivity(actor, activityId, deps);

  const verdict = canPinLibraryRevision(actorUser, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const exists = activity.libraryRefs.some((r) => r.libraryItemId === libraryItemId);
  if (!exists) {
    throw new DomainError(
      "NOT_FOUND",
      "Library item is not attached to this activity.",
      "library_ref_not_attached",
    );
  }
  return activity;
}
