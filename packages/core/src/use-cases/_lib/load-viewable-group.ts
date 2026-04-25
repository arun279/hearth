import {
  DomainError,
  type GroupMembership,
  type StudyGroup,
  type StudyGroupId,
  type User,
  type UserId,
} from "@hearth/domain";
import { canViewGroup } from "@hearth/domain/policy/can-view-group";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

export type ViewableGroupContext = {
  readonly actor: User;
  readonly group: StudyGroup;
  readonly membership: GroupMembership | null;
};

export type LoadViewableGroupDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Load a Study Group + the actor's membership and operator status, then
 * run `canViewGroup`. Throws `DomainError("NOT_FOUND", …)` for a missing
 * actor, missing group, OR a view-denied actor — never `FORBIDDEN`. Routes
 * map `NOT_FOUND` → 404, so a non-member probing by id sees the same
 * status as a non-existent group: existence is not leaked through the
 * 403/404 status-code distinction.
 *
 * Use cases that mutate or read a hideable group MUST load it through
 * this helper rather than calling `groups.byId` directly. The
 * `no-direct-group-byid-in-use-cases` convention check enforces it; see
 * `AGENTS.md` § Viewability before authorization.
 */
export async function loadViewableGroup(
  actorId: UserId,
  groupId: StudyGroupId,
  deps: LoadViewableGroupDeps,
): Promise<ViewableGroupContext> {
  const [actor, group, membership, operator] = await Promise.all([
    deps.users.byId(actorId),
    deps.groups.byId(groupId),
    deps.groups.membership(groupId, actorId),
    deps.policy.getOperator(actorId),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");
  if (!group) throw new DomainError("NOT_FOUND", "Group not found.", "not_found");

  const view = canViewGroup(actor, group, membership, operator);
  if (!view.ok) {
    throw new DomainError("NOT_FOUND", view.reason.message, view.reason.code);
  }

  return { actor, group, membership };
}
