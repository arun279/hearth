import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

/**
 * Can the actor add or list memberships of this group? An active Group Admin
 * is the canonical authority; an active Instance Operator inherits the
 * authority because the Operator administers the instance and may need to
 * recover an orphaned group. Archived groups freeze membership writes — the
 * group must be unarchived first.
 */
export function canManageGroupMembership(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow membership changes.");
  }
  if (isActiveOperator(actor, operator)) return policyAllow();
  if (membership && membership.removedAt === null && membership.role === "admin") {
    return policyAllow();
  }
  return policyDeny("not_group_admin", "Only a Group Admin may manage memberships.");
}
