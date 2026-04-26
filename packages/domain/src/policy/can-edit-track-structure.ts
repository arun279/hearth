import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Editing the Track Structure (free vs ordered_sections + section list)
 * shares the same authority gate as metadata edits but is split into its
 * own policy so logs and the UX can distinguish "renamed the track" from
 * "rearranged sections" — a different blast radius across enrollees who
 * are mid-activity.
 */
export function canEditTrackStructure(
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
    return policyDeny("track_archived", "Archived tracks do not allow structure edits.");
  }
  if (!isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may edit Track Structure.",
    );
  }
  void actor;
  return policyAllow();
}
