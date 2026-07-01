import {
  DomainError,
  type LearningTrack,
  type LearningTrackId,
  type PeerProgressVisibility,
  type UserId,
} from "@hearth/domain";
import { canSetPeerProgressVisibility } from "@hearth/domain/policy/can-set-peer-progress-visibility";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type SetPeerProgressVisibilityInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
  readonly visibility: PeerProgressVisibility;
};

export type SetPeerProgressVisibilityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Set who may see peers' coarse completion progress on a track — the sibling
 * of the Contribution Policy in the Track Settings dialog, gated by the same
 * track authority. Viewability runs first (a non-member 404s on the track),
 * then the authority check (403), then the conditional-UPDATE write in the
 * adapter freezes out an archived track.
 */
export async function setPeerProgressVisibility(
  input: SetPeerProgressVisibilityInput,
  deps: SetPeerProgressVisibilityDeps,
): Promise<LearningTrack> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const verdict = canSetPeerProgressVisibility(
    actor,
    group,
    track,
    groupMembership,
    trackEnrollment,
  );
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.tracks.savePeerProgressVisibility(input.trackId, input.visibility, input.actor);
}
