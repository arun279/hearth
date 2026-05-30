import type { ActivityLibraryRef } from "../activity/types.ts";
import type { ActivityPart } from "../parts/index.ts";
import { libraryItemIdOfPart } from "../parts/library-backed.ts";

/**
 * The Part ids that must restart when a Library Item publishes a newer
 * Revision. A Part is affected only when (a) it references the bumped
 * item and (b) the activity's ref to that item is **unpinned** — a pinned
 * ref resolves to a fixed revision and is immune to the bump, preserving
 * the facilitator's intent to freeze that Part against a known revision.
 *
 * Returning the ids alone (not the Parts) keeps the caller — the
 * `reopenAgainstRevision` transaction — decoupled from the Part bodies;
 * it only needs to know which `part_progress` rows to snapshot-then-reset.
 */
export function affectedPartIdsForRevisionBump(
  activity: {
    readonly parts: readonly ActivityPart[];
    readonly libraryRefs: readonly Pick<ActivityLibraryRef, "libraryItemId" | "pinnedRevisionId">[];
  },
  bumpedLibraryItemId: string,
): readonly string[] {
  const ref = activity.libraryRefs.find((r) => r.libraryItemId === bumpedLibraryItemId);
  if (ref === undefined || ref.pinnedRevisionId !== null) return [];

  return activity.parts
    .filter((part) => libraryItemIdOfPart(part) === bumpedLibraryItemId)
    .map((part) => part.id);
}
