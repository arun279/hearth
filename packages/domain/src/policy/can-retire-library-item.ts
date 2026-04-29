import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { UserId } from "../ids.ts";
import type { InstanceOperator } from "../instance.ts";
import type { LibraryItem } from "../library/types.ts";
import { isLibraryItemSteward } from "./library-stewardship.ts";

/**
 * Authority-only: stewards (uploader, explicit row, Group Admin, Operator
 * carve-out) may retire an item. Idempotence (retire-on-already-retired
 * = no-op returning the existing row) lives in the use case so this
 * predicate stays a clean boolean over actor + membership.
 *
 * Archived groups still allow retirement (a steward might trim the
 * library on the way to fully closing the group out) — re-archiving
 * after retire is a no-op, and the audit trail keeps both events.
 */
export function canRetireLibraryItem(
  actorId: UserId,
  group: StudyGroup,
  item: LibraryItem,
  membership: GroupMembership | null,
  operator: InstanceOperator | null,
  extraStewardIds: ReadonlySet<UserId>,
): PolicyResult {
  void group;
  if (!isLibraryItemSteward(actorId, item, membership, operator, extraStewardIds)) {
    return policyDeny(
      "not_library_steward",
      "Only the uploader, a Steward, a Group Admin, or an Instance Operator may retire this item.",
    );
  }
  return policyAllow();
}
