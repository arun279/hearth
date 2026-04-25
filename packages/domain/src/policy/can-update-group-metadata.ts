import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { User } from "../user.ts";

/**
 * Editing the group's name or description requires an active admin membership
 * AND a non-archived group. Archived groups stay readable but frozen — admins
 * unarchive first, edit second, so the audit trail keeps the two intentions
 * separate.
 */
export function canUpdateGroupMetadata(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow metadata edits.");
  }
  if (!membership || membership.removedAt !== null || membership.role !== "admin") {
    return policyDeny("not_group_admin", "Only a Group Admin may edit the group's metadata.");
  }
  void actor;
  return policyAllow();
}
