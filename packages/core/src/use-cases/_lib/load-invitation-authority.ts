import { DomainError, type StudyGroupId, type UserId } from "@hearth/domain";
import { canCreateGroupInvitation } from "@hearth/domain/policy/can-create-group-invitation";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup, type ViewableGroupContext } from "./load-viewable-group.ts";

export type LoadInvitationAuthorityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Shared preflight for the invitation use cases — both
 * `createGroupInvitation` and `listGroupInvitations` need:
 *   1. Viewability (loadViewableGroup → 404 if non-member),
 *   2. Authority via `canCreateGroupInvitation`.
 *
 * Centralising the two-step here keeps the duplicated pattern out of the
 * call sites and makes the policy gate the single source of truth.
 */
export async function loadInvitationAuthority(
  actor: UserId,
  groupId: StudyGroupId,
  deps: LoadInvitationAuthorityDeps,
): Promise<ViewableGroupContext> {
  const ctx = await loadViewableGroup(actor, groupId, deps);
  const operator = await deps.policy.getOperator(actor);
  const verdict = canCreateGroupInvitation(ctx.actor, ctx.group, ctx.membership, operator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }
  return ctx;
}
