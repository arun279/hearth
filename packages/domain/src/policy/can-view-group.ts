import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator, isCurrentMember } from "./helpers.ts";

/**
 * Visibility gate for a Study Group resource. Active operators see every group
 * (their job is to administer the instance); everyone else must hold a current
 * membership row. Non-members get a denial the route maps to 404 — surfacing
 * 403 would leak existence to anyone with a guessable id.
 */
export function canViewGroup(
  actor: User,
  group: StudyGroup,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
): PolicyResult {
  if (isActiveOperator(actor, operator)) return policyAllow();
  if (isCurrentMember(membership, group.id)) return policyAllow();
  return policyDeny("not_group_member", "Actor is not a current member of the group.");
}
