import type { StudyGroupId, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canUnarchiveGroup } from "@hearth/domain/policy/can-unarchive-group";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type UnarchiveGroupInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
};

export type UnarchiveGroupDeps = {
  readonly groups: StudyGroupRepository;
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/** Mirror of `archiveGroup`. Idempotent on already-active groups. */
export async function unarchiveGroup(
  input: UnarchiveGroupInput,
  deps: UnarchiveGroupDeps,
): Promise<void> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const verdict = canUnarchiveGroup(actor, group, membership);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (group.status === "active") return;

  await deps.groups.updateStatus(input.groupId, "active", input.actor);
}
