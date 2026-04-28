import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import { wouldOrphanFacilitator } from "../track-invariants.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * A track authority removes another enrollee. Mirrors `canLeaveTrack`'s
 * orphan check, but authority comes from group-admin status or active
 * facilitator status — the actor must outrank the operation.
 *
 * Removal of self-by-self goes through `canLeaveTrack` instead — the use
 * cases dispatch on `actorId === targetId` so the SPA's deny copy stays
 * specific to whichever path the user is on.
 */
export function canRemoveTrackEnrollment(
  group: StudyGroup,
  track: LearningTrack,
  actorMembership: GroupMembership | null,
  actorEnrollment: TrackEnrollment | null,
  targetEnrollment: TrackEnrollment,
  currentFacilitatorCount: number,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny(
      "group_archived",
      "Tracks inside an archived group cannot be modified independently.",
    );
  }
  if (!isAuthorityOverTrack(track, actorMembership, actorEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may remove a Track Enrollment.",
    );
  }
  if (targetEnrollment.leftAt !== null) {
    return policyDeny("not_track_enrollee", "Target is already left.");
  }
  if (wouldOrphanFacilitator(track, targetEnrollment, currentFacilitatorCount)) {
    return policyDeny(
      "would_orphan_facilitator",
      "Removing this person would leave the track with no facilitators. Promote a replacement first.",
    );
  }
  return policyAllow();
}
