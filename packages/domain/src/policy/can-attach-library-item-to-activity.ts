import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { LibraryItem } from "../library/types.ts";

/**
 * The activity composer (M8) calls this to decide whether a Library Item
 * is eligible to be attached to a *new or edited* activity. Retired items
 * cannot be attached to new activities — the soft-stop semantic. Existing
 * `activity_library_refs` rows pinning the retired item keep working
 * (those references store a specific `pinnedRevisionId` so historical
 * activities don't break).
 *
 * Attachment authority itself comes from track-facilitator policies in
 * M8; this predicate is just the soft-stop projection over the item's
 * own state.
 */
export function canAttachLibraryItemToActivity(item: LibraryItem): PolicyResult {
  if (item.retiredAt !== null) {
    return policyDeny(
      "library_item_retired",
      "Retired items cannot be attached to new activities.",
    );
  }
  return policyAllow();
}
