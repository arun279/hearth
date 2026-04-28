import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import { wouldOrphanFacilitator } from "../track-invariants.ts";
import { isCurrentEnrollment, isCurrentMember } from "./helpers.ts";

/**
 * Self-leave: the actor ends their own track enrollment. Leaving ends
 * full track access and active participation, but prior Activity Records
 * stay preserved on the track — leaving is reversible at the
 * record-attribution level even though the active enrollment isn't.
 *
 * The orphan-facilitator check applies symmetrically: the last facilitator
 * cannot leave an *active* track without first promoting a replacement.
 * Paused / archived tracks bypass the check (frozen tracks have no live
 * invariant — the seam mirrors `canLeaveGroup`'s archived carve-out).
 *
 * Group-archived denies independently — an archived group is read-only
 * end-to-end, so "leaving a track inside it" has no meaning.
 */
export function canLeaveTrack(
  group: StudyGroup,
  track: LearningTrack,
  membership: GroupMembership | null,
  enrollment: TrackEnrollment | null,
  currentFacilitatorCount: number,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny(
      "group_archived",
      "Tracks inside an archived group cannot be modified independently.",
    );
  }
  if (!isCurrentMember(membership, group.id)) {
    return policyDeny("not_a_member", "Actor is not a current member of the group.");
  }
  if (!enrollment || !isCurrentEnrollment(enrollment, track.id)) {
    return policyDeny(
      "not_track_enrollee",
      "Actor does not have a current Track Enrollment to leave.",
    );
  }
  if (wouldOrphanFacilitator(track, enrollment, currentFacilitatorCount)) {
    return policyDeny(
      "would_orphan_facilitator",
      "You're the only facilitator. Promote another facilitator first, or archive the track.",
    );
  }
  return policyAllow();
}
