import type { ActivityPart } from "./union.ts";

/**
 * The Part kinds backed by a Library Item — the only kinds that resolve a
 * revision, sign a read URL, and participate in revision-bump restarts.
 * `write_reflection` / `quiz` / `attend_session` / `embed` carry no
 * library dependency.
 */
export const LIBRARY_BACKED_PART_KINDS = [
  "read_library_item",
  "listen_audio",
  "watch_video",
] as const;

type LibraryBackedPart = Extract<
  ActivityPart,
  { kind: (typeof LIBRARY_BACKED_PART_KINDS)[number] }
>;

export function isLibraryBackedPart(part: ActivityPart): part is LibraryBackedPart {
  return (
    part.kind === "read_library_item" || part.kind === "listen_audio" || part.kind === "watch_video"
  );
}

/**
 * The Library Item id a Part references, or `null` for the four kinds
 * that carry none. Narrows on the discriminator so no unsafe cast is
 * needed.
 */
export function libraryItemIdOfPart(part: ActivityPart): string | null {
  return isLibraryBackedPart(part) ? part.libraryItemId : null;
}
