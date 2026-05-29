import type { PolicyResult } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { evaluateActivityScopeAuthority } from "./_activity-scope-gate.ts";

/**
 * Hard-delete a Learning Activity. The dependents check ("any other
 * activity holding this as a hard prerequisite?" + "any
 * `activity_records` row?") is enforced inside the use case + the
 * adapter's FK RESTRICT — this predicate covers only the authority
 * gate. The delete itself is hard rather than soft because v1 has no
 * audit-trail surface; archive a track to keep the history.
 */
export function canDeleteLearningActivity(
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
    actionLabel: "delete a Learning Activity",
  });
}
