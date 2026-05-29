import type { PolicyResult } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { evaluateActivityScopeAuthority } from "./_activity-scope-gate.ts";

/**
 * Edit an existing Learning Activity's body — title, description,
 * Parts, Audience, Window/Post-Close, Completion Rule. The gate is
 * track authority + active parent group + non-archived track. Paused
 * tracks remain editable so facilitators can correct in-flight work
 * even after pausing new activity creation.
 */
export function canEditLearningActivity(
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
    actionLabel: "edit a Learning Activity",
  });
}
