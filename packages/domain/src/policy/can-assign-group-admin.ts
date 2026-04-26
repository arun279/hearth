import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import { wouldOrphanAdmin } from "../group-invariants.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

/**
 * Can the actor change `target`'s role between participant and admin? Same
 * rules as removal: active group, current target, ≥1 admin remaining post-flip.
 * The orphan check runs against the *post-flip* admin count by passing the
 * count after deducting `target` if they're being demoted.
 */
export function canAssignGroupAdmin(
  actor: User,
  group: StudyGroup,
  actorMembership: GroupMembership | null,
  target: GroupMembership,
  nextRole: "participant" | "admin",
  currentAdminCount: number,
  operator: InstanceOperator | null,
): PolicyResult {
  if (target.removedAt !== null) {
    return policyDeny("not_group_member", "The target is not a current member.");
  }
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow role changes.");
  }
  // Authority check first so non-admins/non-operators see "not_group_admin"
  // even when their proposed role flip would leave the group's admin count
  // intact (or invariant-broken).
  const operatorOk = isActiveOperator(actor, operator);
  const adminOk =
    actorMembership !== null &&
    actorMembership.removedAt === null &&
    actorMembership.role === "admin";
  if (!operatorOk && !adminOk) {
    return policyDeny("not_group_admin", "Only a Group Admin may change roles.");
  }
  // Demotion check: post-flip admin count would be `current - 1`.
  if (nextRole === "participant" && wouldOrphanAdmin(group, target, currentAdminCount)) {
    return policyDeny(
      "would_orphan_admin",
      "Active groups must keep at least one Group Admin. Assign another admin first.",
    );
  }
  return policyAllow();
}
