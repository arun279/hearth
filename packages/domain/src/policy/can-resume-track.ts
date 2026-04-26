import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Authorization-only mirror of `canPauseTrack`. The transition itself
 * (paused → active) is enforced by the use case via `track-transitions`;
 * this policy only answers "is the actor allowed to attempt a resume?".
 */
export function canResumeTrack(
  actor: User,
  group: StudyGroup,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny(
      "group_archived",
      "Tracks inside an archived group cannot be modified independently.",
    );
  }
  if (!isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may resume a Learning Track.",
    );
  }
  void actor;
  return policyAllow();
}
