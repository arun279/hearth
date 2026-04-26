import {
  DomainError,
  type GroupMembership,
  type LearningTrack,
  type LearningTrackId,
  type StudyGroup,
  type TrackEnrollment,
  type User,
  type UserId,
} from "@hearth/domain";
import { canViewTrack } from "@hearth/domain/policy/can-view-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

export type ViewableTrackContext = {
  readonly actor: User;
  readonly group: StudyGroup;
  readonly track: LearningTrack;
  readonly groupMembership: GroupMembership | null;
  readonly trackEnrollment: TrackEnrollment | null;
};

export type LoadViewableTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Load a Learning Track + the actor's group membership, track enrollment,
 * and operator status, then run `canViewTrack`. Throws
 * `DomainError("NOT_FOUND", …)` for a missing actor / track / group OR a
 * view-denied actor — never `FORBIDDEN`. Routes map `NOT_FOUND` → 404 so a
 * non-member probing by id sees the same status as a non-existent track:
 * existence is not leaked through the 403/404 distinction.
 *
 * Use cases that mutate or read a hideable track MUST load it through this
 * helper rather than calling `tracks.byId` directly. Mirrors
 * `loadViewableGroup` exactly so reviewers reading either side recognize
 * the shape; see `AGENTS.md` § Viewability before authorization.
 */
export async function loadViewableTrack(
  actorId: UserId,
  trackId: LearningTrackId,
  deps: LoadViewableTrackDeps,
): Promise<ViewableTrackContext> {
  // First fetch the track so we can derive its groupId — without it we'd
  // need a second pass to load membership/enrollment, doubling round-trips
  // on the hot path.
  const track = await deps.tracks.byId(trackId);
  if (!track) {
    throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
  }

  const [actor, group, groupMembership, trackEnrollment, operator] = await Promise.all([
    deps.users.byId(actorId),
    deps.groups.byId(track.groupId),
    deps.groups.membership(track.groupId, actorId),
    deps.tracks.enrollment(trackId, actorId),
    deps.policy.getOperator(actorId),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");
  if (!group) {
    // Orphaned track row — should be impossible given the FK, but treat as
    // hidden rather than 500 so probing by id still returns 404.
    throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
  }

  const view = canViewTrack(actor, group, track, groupMembership, operator);
  if (!view.ok) {
    throw new DomainError("NOT_FOUND", view.reason.message, view.reason.code);
  }

  return { actor, group, track, groupMembership, trackEnrollment };
}
