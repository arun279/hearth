import type { GroupMembership } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";

/**
 * A person has supervisory authority over a Learning Track if they are a
 * Group Admin of the containing group, or an active Track Facilitator.
 */
export function isAuthorityOverTrack(
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
): boolean {
  const isActiveGroupAdmin =
    groupMembership !== null &&
    groupMembership.removedAt === null &&
    groupMembership.role === "admin" &&
    groupMembership.groupId === track.groupId;

  const isActiveFacilitator =
    trackEnrollment !== null &&
    trackEnrollment.leftAt === null &&
    trackEnrollment.role === "facilitator" &&
    trackEnrollment.trackId === track.id;

  return isActiveGroupAdmin || isActiveFacilitator;
}
