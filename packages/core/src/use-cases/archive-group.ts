import type { StudyGroupId, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canArchiveGroup } from "@hearth/domain/policy/can-archive-group";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type ArchiveGroupInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
};

export type ArchiveGroupDeps = {
  readonly groups: StudyGroupRepository;
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Archive a Study Group. Idempotent: a retry after the first call landed
 * resolves as a no-op success rather than surfacing as a 4xx. Viewability
 * is enforced via `loadViewableGroup`; the admin check runs after, so a
 * non-admin member sees a uniform 403 for both active and archived states.
 */
export async function archiveGroup(
  input: ArchiveGroupInput,
  deps: ArchiveGroupDeps,
): Promise<void> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const verdict = canArchiveGroup(actor, group, membership);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (group.status === "archived") return;

  await deps.groups.updateStatus(input.groupId, "archived", input.actor);
}
