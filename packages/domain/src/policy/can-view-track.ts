import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LearningTrack } from "../track.ts";
import type { User } from "../user.ts";
import { isActiveOperator, isCurrentMember } from "./helpers.ts";

/**
 * Visibility gate for a Learning Track. Mirrors `canViewGroup`: active
 * operators see every track; everyone else must hold a current membership in
 * the track's parent group. A non-member denial maps to 404 at the route so
 * existence is not leaked through the 403/404 distinction.
 *
 * Track Enrollment is *not* required to view — group members can browse
 * tracks they have not enrolled in. Enrollment is required for participating
 * (M5), not for viewing.
 */
export function canViewTrack(
  actor: User,
  group: StudyGroup,
  track: LearningTrack,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
): PolicyResult {
  if (track.groupId !== group.id) {
    return policyDeny("track_not_in_group", "Track does not belong to the referenced group.");
  }
  if (isActiveOperator(actor, operator)) return policyAllow();
  if (isCurrentMember(membership, group.id)) return policyAllow();
  return policyDeny("not_group_member", "Actor is not a current member of the group.");
}
