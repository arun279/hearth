import type { GroupMembership, StudyGroup } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";

/**
 * The actor is a current, un-removed member of the referenced group.
 */
export function isCurrentMember(
  membership: GroupMembership | null,
  groupId: StudyGroup["id"],
): boolean {
  return membership !== null && membership.removedAt === null && membership.groupId === groupId;
}

/**
 * The actor is a current, un-left enrollee in the referenced track.
 */
export function isCurrentEnrollment(
  enrollment: TrackEnrollment | null,
  trackId: LearningTrack["id"],
): boolean {
  return enrollment !== null && enrollment.leftAt === null && enrollment.trackId === trackId;
}

/**
 * True iff the operator row belongs to the actor and has not been revoked.
 * Defense in depth: requiring userId to match the actor prevents a use case
 * from accidentally passing another user's operator row.
 */
export function isActiveOperator(actor: User, operator: InstanceOperator | null): boolean {
  return operator !== null && operator.revokedAt === null && operator.userId === actor.id;
}

/**
 * A resource is considered writable when its aggregate is not in a terminal
 * read-only state (archived group, archived track, etc.). The group is the
 * outermost envelope — archived groups freeze everything they contain.
 */
export function isWritable(group: StudyGroup, track: LearningTrack | null): boolean {
  if (group.status === "archived") return false;
  if (track !== null && track.status === "archived") return false;
  return true;
}
