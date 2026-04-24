import type { InstanceSettings, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canRenameInstance } from "@hearth/domain/policy";
import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  UserRepository,
} from "@hearth/ports";

export type RenameInstanceInput = {
  readonly actor: UserId;
  readonly name: string;
};

export type RenameInstanceDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly settings: InstanceSettingsRepository;
};

const MIN_NAME = 1;
const MAX_NAME = 80;

export async function renameInstance(
  input: RenameInstanceInput,
  deps: RenameInstanceDeps,
): Promise<InstanceSettings> {
  const trimmed = input.name.trim();
  if (trimmed.length < MIN_NAME || trimmed.length > MAX_NAME) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Instance name must be between ${MIN_NAME} and ${MAX_NAME} characters.`,
      "invalid_instance_name",
    );
  }

  const [actor, operator] = await Promise.all([
    deps.users.byId(input.actor),
    deps.policy.getOperator(input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");

  const verdict = canRenameInstance(actor, operator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.settings.update({ name: trimmed }, input.actor);
}
