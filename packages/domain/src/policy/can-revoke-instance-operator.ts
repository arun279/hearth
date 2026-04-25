import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

/**
 * `activeOperatorCount` is the count of `instance_operators` rows with
 * `revokedAt IS NULL`. The adapter folds the same check into the UPDATE's
 * WHERE clause as a single atomic SQLite statement, so a concurrent revoke
 * of a different target cannot race past the orphan guard.
 */
export function canRevokeInstanceOperator(
  actor: User,
  actorOperator: InstanceOperator | null,
  target: InstanceOperator,
  activeOperatorCount: number,
): PolicyResult {
  if (!isActiveOperator(actor, actorOperator)) {
    return policyDeny(
      "not_instance_operator",
      "Only an Instance Operator may revoke the operator role.",
    );
  }
  if (target.revokedAt !== null) {
    return policyDeny("already_revoked", "This operator role has already been revoked.");
  }
  if (target.userId === actor.id) {
    return policyDeny(
      "cannot_revoke_self",
      "Operators cannot revoke their own operator role. Ask another operator to do it.",
    );
  }
  if (activeOperatorCount <= 1) {
    return policyDeny(
      "would_orphan_operator",
      "An instance must keep at least one operator. Grant the role to someone else before revoking this one.",
    );
  }
  return policyAllow();
}
