import type { LearningTrackId, StudyGroupId, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canEnrollInTrack } from "@hearth/domain/policy/can-enroll-in-track";
import type { LearningTrackRepository, StudyGroupRepository, UserRepository } from "@hearth/ports";

export type EnrollInTrackInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly trackId: LearningTrackId;
};

export type EnrollInTrackDeps = {
  readonly tracks: LearningTrackRepository;
  readonly groups: StudyGroupRepository;
  readonly users: UserRepository;
};

export async function enrollInTrack(
  input: EnrollInTrackInput,
  deps: EnrollInTrackDeps,
): Promise<void> {
  const [actor, track, membership] = await Promise.all([
    deps.users.byId(input.actor),
    deps.tracks.byId(input.trackId),
    deps.groups.membership(input.groupId, input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found");
  if (!track) throw new DomainError("NOT_FOUND", "Track not found");

  const verdict = canEnrollInTrack(actor, track, membership);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  await deps.tracks.enroll(input.trackId, input.actor);
}
