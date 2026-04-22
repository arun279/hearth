import type { StudyGroupId, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canArchiveGroup } from "@hearth/domain/policy/can-archive-group";
import type { StudyGroupRepository, UserRepository } from "@hearth/ports";

export type ArchiveGroupInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
};

export type ArchiveGroupDeps = {
  readonly groups: StudyGroupRepository;
  readonly users: UserRepository;
};

export async function archiveGroup(
  input: ArchiveGroupInput,
  deps: ArchiveGroupDeps,
): Promise<void> {
  const [actor, group, membership] = await Promise.all([
    deps.users.byId(input.actor),
    deps.groups.byId(input.groupId),
    deps.groups.membership(input.groupId, input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found");
  if (!group) throw new DomainError("NOT_FOUND", "Group not found");

  const verdict = canArchiveGroup(actor, group, membership);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  await deps.groups.updateStatus(input.groupId, "archived", input.actor);
}
