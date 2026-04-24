import type { InstanceOperator, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canAssignInstanceOperator } from "@hearth/domain/policy";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";

export type AssignInstanceOperatorInput = {
  readonly actor: UserId;
  readonly target: UserId;
};

export type AssignInstanceOperatorDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

export async function assignInstanceOperator(
  input: AssignInstanceOperatorInput,
  deps: AssignInstanceOperatorDeps,
): Promise<InstanceOperator> {
  const [actor, operator, targetUser] = await Promise.all([
    deps.users.byId(input.actor),
    deps.policy.getOperator(input.actor),
    deps.users.byId(input.target),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");
  if (!targetUser) throw new DomainError("NOT_FOUND", "Target user not found.");

  const verdict = canAssignInstanceOperator(actor, operator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.policy.addOperator(input.target, input.actor);
}
