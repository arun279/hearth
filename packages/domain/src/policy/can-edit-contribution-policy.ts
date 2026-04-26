import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Changing the track's contribution policy is a workflow decision that
 * shifts authority over future submissions — same gate as structure edits,
 * named separately so the audit trail reflects intent rather than a generic
 * "track edited" event.
 */
export function canEditContributionPolicy(
  actor: User,
  group: StudyGroup,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow track edits.");
  }
  if (track.status === "archived") {
    return policyDeny(
      "track_archived",
      "Archived tracks do not allow contribution-policy changes.",
    );
  }
  if (!isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may change the contribution policy.",
    );
  }
  void actor;
  return policyAllow();
}
