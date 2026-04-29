import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { UserId } from "../ids.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LibraryItem } from "../library/types.ts";
import { isLibraryItemSteward } from "./library-stewardship.ts";

/**
 * Adding or removing a Steward from a Library Item requires existing
 * stewardship — i.e., the uploader, an existing Steward, a Group Admin,
 * or an Instance Operator (recovery carve-out). This deliberately allows
 * Stewards to recruit other Stewards without round-tripping through a
 * Group Admin, mirroring how `canAssignTrackFacilitator` lets active
 * facilitators co-opt new ones.
 *
 * Archived groups freeze the list — fixing the steward set on a frozen
 * aggregate would muddy the audit trail; unarchive first if needed.
 */
export function canAddLibraryStewards(
  actorId: UserId,
  group: StudyGroup,
  item: LibraryItem,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
  extraStewardIds: ReadonlySet<UserId>,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow steward changes.");
  }
  if (!isLibraryItemSteward(actorId, item, membership, operator, extraStewardIds)) {
    return policyDeny(
      "not_library_steward",
      "Only an existing Steward, the uploader, a Group Admin, or an Instance Operator may manage Stewards.",
    );
  }
  return policyAllow();
}
