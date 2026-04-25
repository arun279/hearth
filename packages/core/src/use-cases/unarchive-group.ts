import type { StudyGroupId, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canUnarchiveGroup } from "@hearth/domain/policy/can-unarchive-group";
import { canViewGroup } from "@hearth/domain/policy/can-view-group";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

export type UnarchiveGroupInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
};

export type UnarchiveGroupDeps = {
  readonly groups: StudyGroupRepository;
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Unarchive a Study Group. Idempotent — calling on an already-active group
 * is a no-op success.
 */
export async function unarchiveGroup(
  input: UnarchiveGroupInput,
  deps: UnarchiveGroupDeps,
): Promise<void> {
  const [actor, group, membership, operator] = await Promise.all([
    deps.users.byId(input.actor),
    deps.groups.byId(input.groupId),
    deps.groups.membership(input.groupId, input.actor),
    deps.policy.getOperator(input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found");
  if (!group) throw new DomainError("NOT_FOUND", "Group not found", "not_found");

  // View → admin → idempotence ordering. Same security rationale as `archiveGroup`.
  const view = canViewGroup(actor, group, membership, operator);
  if (!view.ok) {
    throw new DomainError("NOT_FOUND", view.reason.message, view.reason.code);
  }

  const verdict = canUnarchiveGroup(actor, group, membership);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (group.status === "active") return;

  await deps.groups.updateStatus(input.groupId, "active", input.actor);
}
