import type { PolicyResult } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { evaluateActivityScopeAuthority } from "./_activity-scope-gate.ts";

/**
 * Reset a participant's progress on an activity — a Track-authority action.
 * The participant's prior work is never destroyed: the reset use case
 * snapshots current Part Progress into Part History (`reason =
 * "facilitator_reset"`) before reopening. Same authority gate as editing
 * the activity itself (Group Admin or Track Facilitator, non-archived
 * track).
 */
export function canResetParticipantProgress(
  _actor: User,
  group: StudyGroup,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
): PolicyResult {
  return evaluateActivityScopeAuthority({
    group,
    track,
    groupMembership,
    trackEnrollment,
    actionLabel: "reset a participant's progress",
  });
}
