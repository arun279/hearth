import type { ActivityFlow } from "./types.ts";

/**
 * Whether a Part's hard prerequisites are satisfied for a participant.
 * A `hard` Flow edge `from → to` gates the `to` Part until `from` is
 * complete; `soft` edges are ordering hints and never gate. Pure and
 * SPA-importable: the player computes per-Part lock state from the same
 * function the server enforces, so the dimmed Parts and the server's
 * `prereq_not_met` denial never disagree.
 */
export function arePartPrerequisitesMet(
  flow: ActivityFlow,
  partId: string,
  completedPartIds: ReadonlySet<string>,
): boolean {
  for (const edge of flow.prereqs) {
    if (
      edge.kind === "hard" &&
      edge.toPartId === partId &&
      !completedPartIds.has(edge.fromPartId)
    ) {
      return false;
    }
  }
  return true;
}
