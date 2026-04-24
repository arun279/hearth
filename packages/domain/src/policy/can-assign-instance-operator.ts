import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { InstanceOperator } from "../instance.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";

export function canAssignInstanceOperator(
  actor: User,
  operator: InstanceOperator | null,
): PolicyResult {
  if (!isActiveOperator(actor, operator)) {
    return policyDeny(
      "not_instance_operator",
      "Only an Instance Operator may grant the operator role.",
    );
  }
  return policyAllow();
}
