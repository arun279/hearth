import { DomainError, type LearningTrack, type LearningTrackId, type UserId } from "@hearth/domain";
import { canEditTrackMetadata } from "@hearth/domain/policy/can-edit-track-metadata";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type UpdateTrackMetadataInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
  readonly name?: string;
  readonly description?: string | null;
};

export type UpdateTrackMetadataDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

const MIN_NAME = 1;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;

/** Edit a Learning Track's name and/or description. Group Admin or active Facilitator only. */
export async function updateTrackMetadata(
  input: UpdateTrackMetadataInput,
  deps: UpdateTrackMetadataDeps,
): Promise<LearningTrack> {
  if (input.name === undefined && input.description === undefined) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Provide a name or description to update.",
      "no_metadata_provided",
    );
  }

  const name = input.name?.trim();
  if (name !== undefined && (name.length < MIN_NAME || name.length > MAX_NAME)) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Track name must be between ${MIN_NAME} and ${MAX_NAME} characters.`,
      "invalid_track_name",
    );
  }
  const description = input.description === null ? null : input.description?.trim();
  if (description !== undefined && description !== null && description.length > MAX_DESCRIPTION) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Track description must be ${MAX_DESCRIPTION} characters or fewer.`,
      "invalid_track_description",
    );
  }

  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const verdict = canEditTrackMetadata(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const normalizedDescription =
    description === undefined
      ? undefined
      : description === null || description.length === 0
        ? null
        : description;

  return deps.tracks.updateMetadata(
    input.trackId,
    {
      ...(name !== undefined ? { name } : {}),
      ...(normalizedDescription !== undefined ? { description: normalizedDescription } : {}),
    },
    input.actor,
  );
}
