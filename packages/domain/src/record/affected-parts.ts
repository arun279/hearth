import type { LearningActivity } from "../activity/types.ts";
import type { ActivityPartId } from "../ids.ts";

/**
 * Map of `libraryItemId → currentRevisionId` (or `null` when the item has
 * no revision yet). The caller resolves both the before- and after-bump
 * maps from `LibraryItemRepository`; this pure function compares them.
 */
export type RevisionMap = ReadonlyMap<string, string | null>;

/**
 * The three Part kinds whose value depends on a Library Item revision.
 * Only these participate in a revision bump — a reflection, quiz, embed,
 * or attend-session Part has no Library backing and is never reopened by a
 * revision change.
 */
const LIBRARY_BACKED_KINDS = new Set(["read_library_item", "listen_audio", "watch_video"]);

/**
 * Pure computation of which Parts a Library Revision bump reopens.
 *
 * A Part is affected iff ALL hold:
 *  1. its kind is Library-backed (`read_library_item` / `listen_audio` /
 *     `watch_video`);
 *  2. it is NOT pinned to a specific revision — a pinned Part deliberately
 *     holds its revision and is immune to bumps;
 *  3. its Library Item's resolved current revision differs between the
 *     before and after maps.
 *
 * Returns the affected Part ids in the activity's Part order. Reflection /
 * quiz / embed / attend-session Parts are excluded by construction (rule
 * 1), and a Library-backed Part whose item revision is unchanged is
 * excluded by rule 3 — so an idempotent re-bump against the same revisions
 * yields an empty list.
 */
export function affectedPartIdsForRevisionBump(
  activity: LearningActivity,
  oldRevisions: RevisionMap,
  newRevisions: RevisionMap,
): readonly ActivityPartId[] {
  const affected: ActivityPartId[] = [];
  for (const part of activity.parts) {
    if (!LIBRARY_BACKED_KINDS.has(part.kind)) continue;
    const backed = part as { id: string; libraryItemId: string; pinnedRevisionId?: string };
    if (backed.pinnedRevisionId !== undefined) continue;
    const before = oldRevisions.get(backed.libraryItemId) ?? null;
    const after = newRevisions.get(backed.libraryItemId) ?? null;
    if (before !== after) {
      affected.push(backed.id as ActivityPartId);
    }
  }
  return affected;
}
