import { DomainError, type StudyGroup, type UserId } from "@hearth/domain";
import { canCreateStudyGroup } from "@hearth/domain/policy/can-create-study-group";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

export type CreateStudyGroupInput = {
  readonly actor: UserId;
  readonly name: string;
  readonly description?: string;
};

export type CreateStudyGroupDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly groups: StudyGroupRepository;
};

const MIN_NAME = 1;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;

/**
 * Create a Study Group. Only an active Instance Operator may create. The
 * adapter atomically inserts the creator as the first admin in the same
 * D1 batch as the group row, satisfying the orphan-admin invariant from
 * the moment the group exists.
 */
export async function createStudyGroup(
  input: CreateStudyGroupInput,
  deps: CreateStudyGroupDeps,
): Promise<StudyGroup> {
  const name = input.name.trim();
  if (name.length < MIN_NAME || name.length > MAX_NAME) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Group name must be between ${MIN_NAME} and ${MAX_NAME} characters.`,
      "invalid_group_name",
    );
  }
  const description = input.description?.trim();
  if (description !== undefined && description.length > MAX_DESCRIPTION) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Group description must be ${MAX_DESCRIPTION} characters or fewer.`,
      "invalid_group_description",
    );
  }

  const [actor, operator] = await Promise.all([
    deps.users.byId(input.actor),
    deps.policy.getOperator(input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");

  const verdict = canCreateStudyGroup(actor, operator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.groups.create({
    name,
    description: description && description.length > 0 ? description : undefined,
    createdBy: input.actor,
  });
}
