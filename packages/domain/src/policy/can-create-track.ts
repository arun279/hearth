import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { User } from "../user.ts";

export function canCreateTrack(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow new Learning Tracks.");
  }
  if (!membership || membership.removedAt !== null) {
    return policyDeny("not_a_member", "Actor is not a current member of the group.");
  }
  if (membership.role !== "admin") {
    return policyDeny("not_group_admin", "Only Group Admins may create a new Learning Track.");
  }
  void actor;
  return policyAllow();
}
