import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Composing a new Learning Activity requires authority over the track
 * (Group Admin or active Facilitator), the parent group to be active,
 * and the track to not be archived. Paused tracks deliberately reject
 * new activities — pause means "no new work opens" — so the use case
 * can rely on this predicate alone for the happy path.
 */
export function canCreateLearningActivity(
  _actor: User,
  group: StudyGroup,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow new Learning Activities.");
  }
  if (track.status === "archived") {
    return policyDeny("track_archived", "Archived tracks do not allow new Learning Activities.");
  }
  if (track.status === "paused") {
    return policyDeny(
      "track_paused",
      "Paused tracks do not allow new Learning Activities. Resume the track first.",
    );
  }
  if (!isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may compose a Learning Activity.",
    );
  }
  return policyAllow();
}
