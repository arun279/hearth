import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Authorization-only: returns whether the actor *may* archive the track.
 * State-transition idempotence (archive on already-archived = no-op) lives
 * in the `archive-track` use case so the policy stays a pure boolean.
 *
 * Authority comes from group admin or active facilitator status — both can
 * end the track's life. The parent group must not be archived (an archived
 * group is already frozen end-to-end; trying to archive a track inside it
 * would muddy the audit trail).
 */
export function canArchiveTrack(
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
      "Only a Group Admin or Track Facilitator may archive a Learning Track.",
    );
  }
  void actor;
  return policyAllow();
}
