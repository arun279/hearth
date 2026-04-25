import type { StudyGroup, UserId } from "@hearth/domain";
import type { StudyGroupRepository } from "@hearth/ports";

export type ListMyGroupsInput = {
  readonly actor: UserId;
};

export type ListMyGroupsDeps = {
  readonly groups: StudyGroupRepository;
};

/**
 * Returns the groups the actor holds an active membership in. The group
 * picker on `/` reads `me/context.memberships` for the list of group ids,
 * but the picker also wants the group rows themselves (name, status) — this
 * use case projects them. Operators see the same list as a non-operator
 * with the same memberships; the operator-only "all groups" view will land
 * with a separate use case if and when it is needed.
 */
export async function listMyGroups(
  input: ListMyGroupsInput,
  deps: ListMyGroupsDeps,
): Promise<readonly StudyGroup[]> {
  return deps.groups.listForUser(input.actor);
}
