import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import { wouldOrphanAdmin } from "../group-invariants.ts";

/**
 * The actor leaves the group themselves. Identical to `canRemoveGroupMember`
 * with `actor === target` — broken out as its own predicate so the use case
 * call site reads cleanly and the SPA can render leave-specific copy.
 *
 * The orphan check still applies: the last admin can't leave an active group
 * without first promoting someone or archiving the group.
 */
export function canLeaveGroup(
  group: StudyGroup,
  membership: GroupMembership | null,
  currentAdminCount: number,
): PolicyResult {
  if (!membership || membership.removedAt !== null) {
    return policyDeny("not_group_member", "Actor is not a current member of the group.");
  }
  if (group.status === "archived") {
    // Archived groups already freeze everything; "leaving" an archived
    // group is meaningless — the membership is read-only history.
    return policyDeny("group_archived", "Archived groups do not allow leaving.");
  }
  if (wouldOrphanAdmin(group, membership, currentAdminCount)) {
    return policyDeny(
      "would_orphan_admin",
      "You're the only Group Admin. Promote another admin first, or archive the group.",
    );
  }
  return policyAllow();
}
