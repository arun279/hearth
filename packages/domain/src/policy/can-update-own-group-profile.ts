import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { UserId } from "../ids.ts";
import type { User } from "../user.ts";

/**
 * A Group Member can update *their own* per-group profile (nickname /
 * avatar / bio) regardless of role. Archived groups freeze profile edits
 * along with everything else inside the aggregate. Updating someone else's
 * profile is never allowed — there is no "facilitator-edits-member-profile"
 * carve-out.
 */
export function canUpdateOwnGroupProfile(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
  targetUserId: UserId,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow profile edits.");
  }
  if (actor.id !== targetUserId) {
    return policyDeny("not_self", "You may only edit your own group profile.");
  }
  if (!membership || membership.removedAt !== null) {
    return policyDeny("not_group_member", "Actor is not a current member of the group.");
  }
  return policyAllow();
}
