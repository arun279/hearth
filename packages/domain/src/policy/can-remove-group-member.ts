import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import { wouldOrphanAdmin } from "../group-invariants.ts";
import type { UserId } from "../ids.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

/**
 * Can the actor remove `target` from this group? Two callers:
 *  - a Group Admin removing someone else,
 *  - or any current member removing themselves (covered separately by
 *    `canLeaveGroup` so the call sites stay readable).
 *
 * Active groups must keep at least one admin; demoting/removing the last
 * admin trips `would_orphan_admin`. Archived groups freeze removals.
 */
export function canRemoveGroupMember(
  actor: User,
  group: StudyGroup,
  actorMembership: GroupMembership | null,
  target: GroupMembership,
  currentAdminCount: number,
  operator: InstanceOperator | null,
): PolicyResult {
  if (target.removedAt !== null) {
    return policyDeny("not_group_member", "The target is not a current member.");
  }
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow membership changes.");
  }
  if (wouldOrphanAdmin(group, target, currentAdminCount)) {
    return policyDeny(
      "would_orphan_admin",
      "Active groups must keep at least one Group Admin. Assign another admin first.",
    );
  }
  if (isActiveOperator(actor, operator)) return policyAllow();
  if (
    actorMembership !== null &&
    actorMembership.removedAt === null &&
    actorMembership.role === "admin"
  ) {
    return policyAllow();
  }
  // The actor removing themselves is OK regardless of their role — they
  // hold the membership being removed.
  if (actorMembership !== null && (actorMembership.userId as UserId) === target.userId) {
    return policyAllow();
  }
  return policyDeny("not_group_admin", "Only a Group Admin may remove other members.");
}
