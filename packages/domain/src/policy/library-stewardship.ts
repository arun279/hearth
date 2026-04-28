import type { GroupMembership } from "../group.ts";
import type { UserId } from "../ids.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LibraryItem } from "../library/types.ts";

/**
 * Decide whether the actor holds steward authority over a Library Item.
 *
 * The original uploader is an *implicit* Steward — we never write a row
 * for them, but every steward predicate accepts them. Beyond the uploader,
 * Stewards are explicit `library_stewards` rows. Group Admins always pass
 * (they hold supervisory authority over everything inside the group), and
 * Instance Operators always pass (their carve-out is the recovery path
 * when no group admin is available).
 *
 * Pure: callers pass `extraStewardIds` (the set of steward user-ids
 * fetched at the call site) so this stays sync and SPA-safe.
 */
export function isLibraryItemSteward(
  actorId: UserId,
  item: LibraryItem,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
  extraStewardIds: ReadonlySet<UserId>,
): boolean {
  if (operator !== null && operator.revokedAt === null && operator.userId === actorId) {
    return true;
  }
  if (
    membership !== null &&
    membership.removedAt === null &&
    membership.userId === actorId &&
    membership.role === "admin"
  ) {
    return true;
  }
  if (item.uploadedBy === actorId) return true;
  return extraStewardIds.has(actorId);
}
