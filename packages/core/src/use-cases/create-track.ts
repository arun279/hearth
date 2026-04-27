import { DomainError, type LearningTrack, type StudyGroupId, type UserId } from "@hearth/domain";
import { canCreateTrack } from "@hearth/domain/policy/can-create-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type CreateTrackInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly name: string;
  readonly description?: string | null;
};

export type CreateTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

const MIN_NAME = 1;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;

/**
 * Create a Learning Track inside a Study Group. Group Admin only. The
 * adapter atomically inserts the track row + the creator's first
 * facilitator enrollment in one D1 batch, satisfying the "active track has
 * ≥ 1 facilitator" invariant from the moment the track exists. Default
 * envelopes (`free` structure, `direct` policy) are applied unless the
 * caller overrides them — M4 ships only the defaults.
 */
export async function createTrack(
  input: CreateTrackInput,
  deps: CreateTrackDeps,
): Promise<LearningTrack> {
  const name = input.name.trim();
  if (name.length < MIN_NAME || name.length > MAX_NAME) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Track name must be between ${MIN_NAME} and ${MAX_NAME} characters.`,
      "invalid_track_name",
    );
  }
  const rawDescription = input.description === null ? null : input.description?.trim();
  if (
    rawDescription !== undefined &&
    rawDescription !== null &&
    rawDescription.length > MAX_DESCRIPTION
  ) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Track description must be ${MAX_DESCRIPTION} characters or fewer.`,
      "invalid_track_description",
    );
  }

  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const verdict = canCreateTrack(actor, group, membership);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  // Empty-string description from the SPA collapses to null so we don't
  // store whitespace as a "present" description.
  const description =
    rawDescription === undefined || rawDescription === null || rawDescription.length === 0
      ? null
      : rawDescription;

  return deps.tracks.create({
    groupId: input.groupId,
    name,
    description,
    createdBy: input.actor,
  });
}
