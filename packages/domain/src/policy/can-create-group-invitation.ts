import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

/**
 * Group Admins (and Instance Operators acting on the group) may mint
 * invitations for an active group. Track-targeted invitations also require
 * facilitator authority over that track — that check lives with the M5
 * use case where the track aggregate is in scope; M3 only validates the
 * group-side invitation.
 */
export function canCreateGroupInvitation(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow new invitations.");
  }
  if (isActiveOperator(actor, operator)) return policyAllow();
  if (membership && membership.removedAt === null && membership.role === "admin") {
    return policyAllow();
  }
  return policyDeny("not_group_admin", "Only a Group Admin may create invitations.");
}
