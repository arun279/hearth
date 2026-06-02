import type { PolicyResult } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { evaluateActivityScopeAuthority } from "./_activity-scope-gate.ts";

/**
 * Narrow an activity's audience from `everyone_enrolled` to a `subset`
 * of explicit user ids. The "every userId is a current track enrollee"
 * invariant is enforced in the use case (`audience_user_not_enrolled`);
 * this predicate covers only the authority gate.
 */
export function canNarrowAudience(
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
    actionLabel: "narrow the Audience",
  });
}
