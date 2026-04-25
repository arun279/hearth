import { DomainError, type StudyGroup, type StudyGroupId, type UserId } from "@hearth/domain";
import { canUpdateGroupMetadata } from "@hearth/domain/policy/can-update-group-metadata";
import type { StudyGroupRepository, UserRepository } from "@hearth/ports";

export type UpdateGroupMetadataInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly name?: string;
  readonly description?: string | null;
};

export type UpdateGroupMetadataDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
};

const MIN_NAME = 1;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;

export async function updateGroupMetadata(
  input: UpdateGroupMetadataInput,
  deps: UpdateGroupMetadataDeps,
): Promise<StudyGroup> {
  if (input.name === undefined && input.description === undefined) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Provide a name or description to update.",
      "no_metadata_provided",
    );
  }

  const name = input.name?.trim();
  if (name !== undefined && (name.length < MIN_NAME || name.length > MAX_NAME)) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Group name must be between ${MIN_NAME} and ${MAX_NAME} characters.`,
      "invalid_group_name",
    );
  }
  const description = input.description === null ? null : input.description?.trim();
  if (description !== undefined && description !== null && description.length > MAX_DESCRIPTION) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Group description must be ${MAX_DESCRIPTION} characters or fewer.`,
      "invalid_group_description",
    );
  }

  const [actor, group, membership] = await Promise.all([
    deps.users.byId(input.actor),
    deps.groups.byId(input.groupId),
    deps.groups.membership(input.groupId, input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");
  if (!group) throw new DomainError("NOT_FOUND", "Group not found.");

  const verdict = canUpdateGroupMetadata(actor, group, membership);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  // Empty-string description from the SPA collapses to null so we don't
  // store whitespace as a "present" description.
  const normalizedDescription =
    description === undefined
      ? undefined
      : description === null || description.length === 0
        ? null
        : description;

  return deps.groups.updateMetadata(
    input.groupId,
    {
      ...(name !== undefined ? { name } : {}),
      ...(normalizedDescription !== undefined ? { description: normalizedDescription } : {}),
    },
    input.actor,
  );
}
