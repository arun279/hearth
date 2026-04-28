import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { UserId } from "../ids.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LibraryItem } from "../library/types.ts";
import { isLibraryItemSteward } from "./library-stewardship.ts";

/**
 * A new revision can replace the current pinned body of an existing Library
 * Item. Stewardship gates the action — the uploader, explicit Stewards,
 * Group Admins, and the Instance Operator (recovery carve-out) all pass.
 * Archived groups and retired items freeze: an archived group is read-only
 * end-to-end, and a retired item rejects new revisions so its body stops
 * changing while existing references keep reading the last good revision.
 */
export function canAddLibraryRevision(
  actorId: UserId,
  group: StudyGroup,
  item: LibraryItem,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
  extraStewardIds: ReadonlySet<UserId>,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow new revisions.");
  }
  if (item.retiredAt !== null) {
    return policyDeny("library_item_retired", "Retired items do not accept new revisions.");
  }
  if (!isLibraryItemSteward(actorId, item, membership, operator, extraStewardIds)) {
    return policyDeny(
      "not_library_steward",
      "Only the uploader, a Steward, a Group Admin, or an Instance Operator may add a revision.",
    );
  }
  return policyAllow();
}
