import type { UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canRevokeInstanceOperator } from "@hearth/domain/policy";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";

export type RevokeInstanceOperatorInput = {
  readonly actor: UserId;
  readonly target: UserId;
};

export type RevokeInstanceOperatorDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

export async function revokeInstanceOperator(
  input: RevokeInstanceOperatorInput,
  deps: RevokeInstanceOperatorDeps,
): Promise<void> {
  const [actor, actorOperator, targetOperator] = await Promise.all([
    deps.users.byId(input.actor),
    deps.policy.getOperator(input.actor),
    deps.policy.getOperator(input.target),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");
  if (!targetOperator) throw new DomainError("NOT_FOUND", "Target is not an operator.");

  const verdict = canRevokeInstanceOperator(actor, actorOperator, targetOperator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  await deps.policy.revokeOperator(input.target, input.actor);
}
