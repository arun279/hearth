import type { ActivityAudience } from "../activity/types.ts";
import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isActiveOperator, isCurrentMember } from "./helpers.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Visibility gate for a Learning Activity. The composer-side authority
 * predicates (`canEditLearningActivity` etc.) decide who may *change*
 * the activity; this predicate decides who may *see* it at all. The
 * route converts a denial into NOT_FOUND so a non-viewer cannot tell a
 * private activity from a non-existent one.
 *
 * Order matters:
 *   1. Active operator → always allow (they administer the instance).
 *   2. Track authority → allow even when the audience is narrowed (a
 *      facilitator needs to QA an activity they restricted to a subset).
 *   3. Non-member → deny `not_group_member`. The non-member should never
 *      learn an activity by this id exists.
 *   4. `audience.kind === "subset"` → only listed user ids may see it;
 *      others get `not_in_audience` (also 404 at the route).
 *   5. Otherwise → allow.
 *
 * Window-driven access transitions (`pre_open` / `locked` / post-close
 * `hidden`) are NOT this predicate's concern — they live in
 * `computeActivityAccessState`. The use case combines the two: a viewer
 * may have policy-level access yet still see the activity collapse to
 * NOT_FOUND when `accessState === "hidden"` after the close instant.
 */
export function canSeeActivity(
  actor: User,
  group: StudyGroup,
  track: LearningTrack,
  audience: ActivityAudience,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
  operator: InstanceOperator | null,
): PolicyResult {
  if (isActiveOperator(actor, operator)) return policyAllow();

  if (isAuthorityOverTrack(track, groupMembership, trackEnrollment)) return policyAllow();

  if (!isCurrentMember(groupMembership, group.id)) {
    return policyDeny("not_group_member", "Actor is not a current member of the group.");
  }

  if (audience.kind === "subset") {
    const inAudience = audience.userIds.some((id) => id === actor.id);
    if (!inAudience) {
      return policyDeny("not_in_audience", "Actor is not in this Activity's audience.");
    }
  }

  return policyAllow();
}
