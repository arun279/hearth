import {
  DomainError,
  type LearningTrack,
  type LearningTrackId,
  type TrackStructureEnvelope,
  type UserId,
} from "@hearth/domain";
import { canEditTrackStructure } from "@hearth/domain/policy/can-edit-track-structure";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type SaveTrackStructureInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
  readonly envelope: TrackStructureEnvelope;
};

export type SaveTrackStructureDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Replace the Track Structure envelope. The activity-id-subset invariant
 * (every id referenced by `ordered_sections` must belong to the track) is
 * vacuously satisfied in M4 — no activities exist yet. M8 will tighten this
 * use case with a subset check against the activity repository when
 * activities land.
 */
export async function saveTrackStructure(
  input: SaveTrackStructureInput,
  deps: SaveTrackStructureDeps,
): Promise<LearningTrack> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const verdict = canEditTrackStructure(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.tracks.saveStructure(input.trackId, input.envelope, input.actor);
}
