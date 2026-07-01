import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Changing who may see peers' coarse completion progress is a track-level
 * workflow decision, the same authority that owns the contribution policy: a
 * Group Admin or Track Facilitator. Denies on an archived group or track —
 * frozen tracks take no settings writes — but a paused track is still
 * configurable.
 */
export function canSetPeerProgressVisibility(
  _actor: User,
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
      "Archived tracks do not allow progress-visibility changes.",
    );
  }
  if (!isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may change progress visibility.",
    );
  }
  return policyAllow();
}
