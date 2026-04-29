import type { GroupMembership, InstanceOperator } from "@hearth/domain";
import {
  DomainError,
  type LibraryItem,
  type LibraryItemId,
  type StudyGroup,
  type User,
  type UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./load-viewable-group.ts";

export type ViewableLibraryItemContext = {
  readonly actor: User;
  readonly group: StudyGroup;
  readonly membership: GroupMembership | null;
  readonly operator: InstanceOperator | null;
  readonly item: LibraryItem;
  readonly stewardSet: ReadonlySet<UserId>;
};

export type LoadViewableLibraryItemDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

/**
 * Load a Library Item gated by group viewability. Mirrors
 * `loadViewableGroup` so existence is never leaked: a non-viewer of the
 * group sees the same `NOT_FOUND` whether the item exists or not.
 *
 * Returns the assembled context every steward-gated use case needs:
 * actor, group, membership, operator, item, and the explicit-steward set
 * (excluding the implicit uploader, which the policy handles).
 */
export async function loadViewableLibraryItem(
  actorId: UserId,
  itemId: LibraryItemId,
  deps: LoadViewableLibraryItemDeps,
): Promise<ViewableLibraryItemContext> {
  const item = await deps.library.byId(itemId);
  if (!item) throw new DomainError("NOT_FOUND", "Library item not found.", "not_found");

  const { actor, group, membership } = await loadViewableGroup(actorId, item.groupId, deps);
  const [operator, stewards] = await Promise.all([
    deps.policy.getOperator(actorId),
    deps.library.listStewards(itemId),
  ]);
  const stewardSet: ReadonlySet<UserId> = new Set(stewards.map((s) => s.userId));
  return { actor, group, membership, operator, item, stewardSet };
}
