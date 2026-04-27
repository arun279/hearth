import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Returns whether the actor may pause the track. Denies on archived
 * tracks because pause→archived would be the only legal transition from
 * archived — i.e., pause itself is not (the use case's
 * `transitions.ts` rejects it). Surfacing this in the policy keeps
 * `caps.canPause` honest, so the SPA's settings affordance hides
 * automatically on archived tracks rather than rendering a button that
 * always errors on click.
 */
export function canPauseTrack(
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
  if (track.status === "archived") {
    return policyDeny("track_archived", "Archived tracks cannot be paused.");
  }
  if (!isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may pause a Learning Track.",
    );
  }
  void actor;
  return policyAllow();
}
