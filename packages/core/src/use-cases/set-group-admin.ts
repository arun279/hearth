import {
  DomainError,
  type GroupMembership,
  type GroupRole,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { canAssignGroupAdmin } from "@hearth/domain/policy/can-assign-group-admin";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type SetGroupAdminInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly target: UserId;
  readonly role: GroupRole;
};

export type SetGroupAdminDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Promote a participant to admin, or demote an admin to participant. The
 * adapter re-checks the orphan invariant inside the conditional UPDATE so
 * a concurrent demote-and-leave race can't drop the active admin count
 * below 1. The use case's pre-check catches the common case early so the
 * SPA can show a meaningful error rather than the generic CONFLICT.
 */
export async function setGroupAdmin(
  input: SetGroupAdminInput,
  deps: SetGroupAdminDeps,
): Promise<GroupMembership> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const [targetMembership, adminCount, operator] = await Promise.all([
    deps.groups.membership(input.groupId, input.target),
    deps.groups.countAdmins(input.groupId),
    deps.policy.getOperator(input.actor),
  ]);
  if (!targetMembership || targetMembership.removedAt !== null) {
    throw new DomainError("NOT_FOUND", "Target is not a current member.", "not_group_member");
  }
  if (targetMembership.role === input.role) {
    // Idempotent no-op; return the existing membership without an UPDATE.
    return targetMembership;
  }

  const verdict = canAssignGroupAdmin(
    actor,
    group,
    membership,
    targetMembership,
    input.role,
    adminCount,
    operator,
  );
  if (!verdict.ok) {
    const code = verdict.reason.code === "would_orphan_admin" ? "CONFLICT" : "FORBIDDEN";
    throw new DomainError(code, verdict.reason.message, verdict.reason.code);
  }

  return deps.groups.setMembershipRole({
    groupId: input.groupId,
    userId: input.target,
    role: input.role,
    by: input.actor,
  });
}
