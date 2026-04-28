import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import { wouldOrphanFacilitator } from "../track-invariants.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Demote a current facilitator back to participant. Authority comes from
 * group-admin status or active facilitator on the same track. The
 * orphan-facilitator invariant applies on active tracks; paused / archived
 * tracks intentionally bypass the check.
 *
 * Self-demotion is allowed when it doesn't orphan; the SPA routes the
 * "step down as facilitator" affordance through this same predicate so
 * the deny code is consistent with the People-tab Demote action.
 */
export function canRemoveTrackFacilitator(
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
      "Only a Group Admin or Track Facilitator may demote facilitators.",
    );
  }
  if (targetEnrollment.leftAt !== null || targetEnrollment.role !== "facilitator") {
    return policyDeny("not_facilitator", "Target is not a current facilitator.");
  }
  if (wouldOrphanFacilitator(track, targetEnrollment, currentFacilitatorCount)) {
    return policyDeny(
      "would_orphan_facilitator",
      "Demoting this person would leave the track with no facilitators. Promote a replacement first.",
    );
  }
  return policyAllow();
}
