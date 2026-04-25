import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { User } from "../user.ts";

/**
 * Authorization-only mirror of `canArchiveGroup`. Named separately so logs
 * and UX copy can distinguish the actor's intent. State-transition
 * idempotence lives in the `unarchive-group` use case.
 */
export function canUnarchiveGroup(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
): PolicyResult {
  void group;
  if (!membership || membership.removedAt !== null || membership.role !== "admin") {
    return policyDeny("not_group_admin", "Only a Group Admin may unarchive a Study Group.");
  }
  void actor;
  return policyAllow();
}
