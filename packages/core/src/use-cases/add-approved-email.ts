import type { ApprovedEmail, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canAddApprovedEmail } from "@hearth/domain/policy";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";

export type AddApprovedEmailInput = {
  readonly actor: UserId;
  readonly email: string;
  readonly note?: string;
};

export type AddApprovedEmailDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

export async function addApprovedEmail(
  input: AddApprovedEmailInput,
  deps: AddApprovedEmailDeps,
): Promise<ApprovedEmail> {
  const [actor, operator] = await Promise.all([
    deps.users.byId(input.actor),
    deps.policy.getOperator(input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");

  const verdict = canAddApprovedEmail(actor, operator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.policy.addApprovedEmail(input.email, input.actor, input.note);
}
