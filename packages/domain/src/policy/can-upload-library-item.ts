import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { User } from "../user.ts";

/**
 * Any current Group Member may upload a NEW Library Item to the group.
 * Authorship gating happens at the activity layer (M8) — the library
 * surface is intentionally low-friction so a participant can drop a
 * reference handout in the shared store without permission churn.
 *
 * Archived groups freeze the library along with everything else: the
 * existing items stay readable / downloadable but no new uploads land.
 */
export function canUploadLibraryItem(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow new uploads.");
  }
  if (!membership || membership.removedAt !== null) {
    return policyDeny("not_group_member", "Only Group Members may upload to the library.");
  }
  void actor;
  return policyAllow();
}
