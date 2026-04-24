import type { UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canRemoveApprovedEmail } from "@hearth/domain/policy";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";

export type RemoveApprovedEmailInput = {
  readonly actor: UserId;
  readonly email: string;
};

export type RemoveApprovedEmailDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

export async function removeApprovedEmail(
  input: RemoveApprovedEmailInput,
  deps: RemoveApprovedEmailDeps,
): Promise<void> {
  const [actor, operator] = await Promise.all([
    deps.users.byId(input.actor),
    deps.policy.getOperator(input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");

  const verdict = canRemoveApprovedEmail(actor, operator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  await deps.policy.removeApprovedEmail(input.email, input.actor);
}
