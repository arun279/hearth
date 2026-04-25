import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { User } from "../user.ts";

/**
 * Authorization-only: returns whether the actor *may* archive the group.
 * State-transition idempotence (archive on already-archived = no-op) lives
 * in the `archive-group` use case so the policy stays a pure boolean
 * over actor + membership, not a precondition over current status.
 */
export function canArchiveGroup(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
): PolicyResult {
  void group;
  if (!membership || membership.removedAt !== null || membership.role !== "admin") {
    return policyDeny("not_group_admin", "Only a Group Admin may archive a Study Group.");
  }
  void actor;
  return policyAllow();
}
