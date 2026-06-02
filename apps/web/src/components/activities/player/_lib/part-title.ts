import type { ActivityPart } from "@hearth/domain";
import { partKindLabel } from "@hearth/ui";

/**
 * The accessible label used for one Part across every player surface
 * (FlowSidebar on desktop, PartTabBar on mobile). One helper for the
 * whole player keeps both surfaces in lockstep — drift between the
 * sidebar and the pill bar was a real Critical from a prior review.
 *
 * Format: `"<ordinal>. <title-or-kind-label>"` — number first so a
 * screen reader announces the position before the name, and the visual
 * ordering matches the prototype's compact list shape.
 */
export function partTitle(part: ActivityPart, index: number): string {
  return `${index + 1}. ${partLabel(part)}`;
}

/**
 * The accessible name for a Part's renderer surface (the `<audio>` /
 * `<video>` / `<iframe>` element itself, not the navigation pill). Per-
 * Part titles are optional in the domain, so the fallback uses the
 * Part-kind label ("Audio clip", "Video", etc.) — never an empty
 * string. Used as `aria-label` on the native media element so screen
 * readers announce the surface as it gains focus.
 */
export function partLabel(part: ActivityPart): string {
  if ("title" in part && typeof part.title === "string" && part.title.length > 0) {
    return part.title;
  }
  return partKindLabel(part.kind);
}
