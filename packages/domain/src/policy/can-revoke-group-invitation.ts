import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

/**
 * Same authority as creation. Revoke is allowed even on archived groups so an
 * Operator can pull invitations after a group is shut down — the action is
 * defensive, not a content edit.
 */
export function canRevokeGroupInvitation(
  actor: User,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
): PolicyResult {
  if (isActiveOperator(actor, operator)) return policyAllow();
  if (membership && membership.removedAt === null && membership.role === "admin") {
    return policyAllow();
  }
  return policyDeny("not_group_admin", "Only a Group Admin may revoke invitations.");
}
