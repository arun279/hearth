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
  const label =
    "title" in part && typeof part.title === "string" ? part.title : partKindLabel(part.kind);
  return `${index + 1}. ${label}`;
}
