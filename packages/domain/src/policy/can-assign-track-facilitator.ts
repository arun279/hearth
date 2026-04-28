import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Promote a current participant on this track to facilitator. Per CONTEXT.md
 * ("A Track Facilitator must have Track Enrollment in that Learning Track")
 * the target must already hold a current enrollment — we don't materialize
 * one as a side-effect, because the dual paths (admin invites a non-member;
 * admin promotes a current participant) have very different consent
 * implications.
 *
 * Authority-only on this side. Demotion lives in `canRemoveTrackFacilitator`
 * because demotion has the orphan check; promotion does not.
 */
export function canAssignTrackFacilitator(
  group: StudyGroup,
  track: LearningTrack,
  actorMembership: GroupMembership | null,
  actorEnrollment: TrackEnrollment | null,
  targetEnrollment: TrackEnrollment | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny(
      "group_archived",
      "Tracks inside an archived group cannot be modified independently.",
    );
  }
  if (track.status === "archived") {
    return policyDeny("track_archived", "Archived tracks do not allow role changes.");
  }
  if (!isAuthorityOverTrack(track, actorMembership, actorEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may promote facilitators.",
    );
  }
  if (
    !targetEnrollment ||
    targetEnrollment.leftAt !== null ||
    targetEnrollment.trackId !== track.id
  ) {
    return policyDeny(
      "not_track_enrollee",
      "Target must already have a current Track Enrollment before being promoted to facilitator.",
    );
  }
  return policyAllow();
}
