import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { UserId } from "../ids.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LibraryItem } from "../library/types.ts";
import { isLibraryItemSteward } from "./library-stewardship.ts";

/**
 * Editing the title / description / tags is steward-or-admin authority.
 * A retired item still allows metadata edits — fixing a typo on a
 * retired body is helpful for the activity history that still pins the
 * old revision. Archived groups freeze metadata along with everything
 * else.
 */
export function canUpdateLibraryMetadata(
  actorId: UserId,
  group: StudyGroup,
  item: LibraryItem,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
  extraStewardIds: ReadonlySet<UserId>,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny("group_archived", "Archived groups do not allow metadata edits.");
  }
  if (!isLibraryItemSteward(actorId, item, membership, operator, extraStewardIds)) {
    return policyDeny(
      "not_library_steward",
      "Only the uploader, a Steward, a Group Admin, or an Instance Operator may edit this item.",
    );
  }
  return policyAllow();
}
