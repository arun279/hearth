import {
  DomainError,
  type LearningTrackId,
  type TrackEnrollment,
  type UserId,
} from "@hearth/domain";
import { canRemoveTrackEnrollment } from "@hearth/domain/policy/can-remove-track-enrollment";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";
import {
  assertEnrollmentPolicy,
  loadTargetForEnrollmentMutation,
} from "./_lib/track-enrollment-mutation.ts";

export type RemoveTrackEnrollmentInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
  readonly target: UserId;
};

export type RemoveTrackEnrollmentDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * A track authority removes another enrollee from a track. Self-by-self
 * goes through `leaveTrack` instead — the deny copy is more specific
 * there. The orphan check fires inside the adapter's UPDATE so a concurrent
 * race cannot land an orphaned track.
 */
export async function removeTrackEnrollment(
  input: RemoveTrackEnrollmentInput,
  deps: RemoveTrackEnrollmentDeps,
): Promise<TrackEnrollment> {
  if (input.actor === input.target) {
    throw new DomainError(
      "CONFLICT",
      "Use the leave-track route to leave on your own behalf.",
      "self_remove_via_leave",
    );
  }

  const { group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const { targetEnrollment, facilitatorCount } = await loadTargetForEnrollmentMutation(
    deps.tracks,
    input.trackId,
    input.target,
  );

  assertEnrollmentPolicy(
    canRemoveTrackEnrollment(
      group,
      track,
      groupMembership,
      trackEnrollment,
      targetEnrollment,
      facilitatorCount,
    ),
  );

  return deps.tracks.unenroll({
    trackId: input.trackId,
    userId: input.target,
    by: input.actor,
  });
}
