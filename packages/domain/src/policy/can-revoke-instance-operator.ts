import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

export function canRevokeInstanceOperator(
  actor: User,
  operator: InstanceOperator | null,
  target: InstanceOperator,
): PolicyResult {
  if (!isActiveOperator(actor, operator)) {
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
  return policyAllow();
}
