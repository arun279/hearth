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
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./load-viewable-group.ts";

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
 * Load a Learning Track and its parent group + actor context, with
 * visibility gated through the group's wrapper. Throws
 * `DomainError("NOT_FOUND", …)` for a missing actor / track / group OR a
 * view-denied actor — never `FORBIDDEN`. Routes map `NOT_FOUND` → 404 so a
 * non-member probing by id sees the same status as a non-existent track.
 *
 * The parent-group load delegates to `loadViewableGroup` rather than
 * calling `groups.byId` here directly: that helper IS the safe path, and
 * the visibility check it bundles (`canViewGroup`) is exactly the gate we
 * need — group membership (or operator status) is what authorizes seeing
 * a track inside the group.
 */
export async function loadViewableTrack(
  actorId: UserId,
  trackId: LearningTrackId,
  deps: LoadViewableTrackDeps,
): Promise<ViewableTrackContext> {
  const track = await deps.tracks.byId(trackId);
  if (!track) {
    throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
  }

  const {
    actor,
    group,
    membership: groupMembership,
  } = await loadViewableGroup(actorId, track.groupId, deps);

  // The port contract for `byId(id)` does not formally declare
  // `result.id === id`. Guards against test-fake drift, memoizing
  // wrappers, or future bulk-load helpers that violate the implicit
  // invariant — NOT_FOUND collapses to the same response shape as a
  // non-existent track, preserving the helper's enumeration-oracle
  // protection.
  if (track.groupId !== group.id) {
    throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
  }

  const trackEnrollment = await deps.tracks.enrollment(trackId, actorId);

  return { actor, group, track, groupMembership, trackEnrollment };
}
