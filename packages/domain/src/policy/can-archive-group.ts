import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { User } from "../user.ts";

export function canArchiveGroup(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("already_archived", "Group is already archived.");
  }
  if (!membership || membership.removedAt !== null || membership.role !== "admin") {
    return policyDeny("not_group_admin", "Only a Group Admin may archive a Study Group.");
  }
  void actor;
  return policyAllow();
}
