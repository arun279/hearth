import {
  type ContributionPolicyEnvelope,
  DomainError,
  type LearningTrack,
  type LearningTrackId,
  type UserId,
} from "@hearth/domain";
import { canEditContributionPolicy } from "@hearth/domain/policy/can-edit-contribution-policy";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type SaveContributionPolicyInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
  readonly envelope: ContributionPolicyEnvelope;
};

export type SaveContributionPolicyDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Replace the Contribution Policy envelope. Workflow change: a transition
 * from `none` to `direct` does not retroactively publish anything in the
 * Pending queue — that decision lives in M15's review flow.
 */
export async function saveContributionPolicy(
  input: SaveContributionPolicyInput,
  deps: SaveContributionPolicyDeps,
): Promise<LearningTrack> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const verdict = canEditContributionPolicy(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.tracks.saveContributionPolicy(input.trackId, input.envelope, input.actor);
}
