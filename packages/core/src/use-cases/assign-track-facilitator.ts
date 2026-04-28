import {
  DomainError,
  type LearningTrackId,
  type TrackEnrollment,
  type UserId,
} from "@hearth/domain";
import { canAssignTrackFacilitator } from "@hearth/domain/policy/can-assign-track-facilitator";
import { canRemoveTrackFacilitator } from "@hearth/domain/policy/can-remove-track-facilitator";
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

export type SetTrackFacilitatorInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
  readonly target: UserId;
};

export type SetTrackFacilitatorDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Promote a current participant on this track to facilitator. Authority
 * comes from group-admin status or active facilitator status. Idempotent:
 * promoting an existing facilitator is a no-op.
 */
export async function assignTrackFacilitator(
  input: SetTrackFacilitatorInput,
  deps: SetTrackFacilitatorDeps,
): Promise<TrackEnrollment> {
  const { group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const targetEnrollment = await deps.tracks.enrollment(input.trackId, input.target);
  const verdict = canAssignTrackFacilitator(
    group,
    track,
    groupMembership,
    trackEnrollment,
    targetEnrollment,
  );
  if (!verdict.ok) {
    const code = verdict.reason.code === "track_archived" ? "CONFLICT" : "FORBIDDEN";
    throw new DomainError(code, verdict.reason.message, verdict.reason.code);
  }

  return deps.tracks.setEnrollmentRole({
    trackId: input.trackId,
    userId: input.target,
    role: "facilitator",
    by: input.actor,
  });
}

/**
 * Demote a current facilitator back to participant. Same orphan check as
 * `removeTrackEnrollment` runs inside the adapter so a demote-and-leave
 * race cannot drop the active facilitator count below 1.
 */
export async function removeTrackFacilitator(
  input: SetTrackFacilitatorInput,
  deps: SetTrackFacilitatorDeps,
): Promise<TrackEnrollment> {
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
    canRemoveTrackFacilitator(
      group,
      track,
      groupMembership,
      trackEnrollment,
      targetEnrollment,
      facilitatorCount,
    ),
  );

  return deps.tracks.setEnrollmentRole({
    trackId: input.trackId,
    userId: input.target,
    role: "participant",
    by: input.actor,
  });
}
