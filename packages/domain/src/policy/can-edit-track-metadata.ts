import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Editing the track's name or description requires authority over the
 * track (Group Admin or active Facilitator), the parent group to be active,
 * and the track itself to not be archived. Paused tracks remain editable —
 * a pause stops new work, not corrections to the existing description.
 */
export function canEditTrackMetadata(
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
    return policyDeny("track_archived", "Archived tracks do not allow metadata edits.");
  }
  if (!isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may edit a Learning Track.",
    );
  }
  void actor;
  return policyAllow();
}
