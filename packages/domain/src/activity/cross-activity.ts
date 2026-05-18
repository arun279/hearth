import type { LearningActivityId } from "../ids.ts";
import type { InvariantResult } from "./invariants.ts";

const ok = (): InvariantResult => ({ ok: true });
const fail = (code: string, message: string): InvariantResult => ({
  ok: false,
  code,
  message,
});

/**
 * Cycle detection across activities for the **hard** prerequisite graph
 * — Activity A "requires" Activity B is a hard edge in this DAG. Suggested
 * Sequences are non-blocking and not cycle-checked.
 *
 * Inputs:
 *   - `activityId`: the activity being edited (must be in `existingEdges`'s
 *     vertex set even if it has no outgoing edges yet).
 *   - `prerequisiteActivityIds`: the proposed new outgoing edge set from
 *     this activity to its prereqs.
 *   - `existingEdges`: every other (activityId → prereq) edge currently
 *     in `activity_prerequisites`. The use case loads this from the repo
 *     at write time; the adapter re-runs the check inside its transaction
 *     for defense-in-depth.
 *
 * Returns `ok` when the post-write graph is acyclic; `cross_activity_prereq_cycle`
 * with the detected cycle in the message otherwise.
 */
export type CrossActivityEdge = {
  readonly activityId: LearningActivityId;
  readonly prerequisiteActivityId: LearningActivityId;
};

export function assertActivityPrerequisitesAcyclic(
  activityId: LearningActivityId,
  prerequisiteActivityIds: readonly LearningActivityId[],
  existingEdges: readonly CrossActivityEdge[],
): InvariantResult {
  // Self-edge is a degenerate cycle.
  for (const prereq of prerequisiteActivityIds) {
    if (prereq === activityId) {
      return fail(
        "cross_activity_prereq_cycle",
        "An activity cannot list itself as a prerequisite.",
      );
    }
  }

  const adjacency = new Map<string, string[]>();
  const addEdge = (from: string, to: string) => {
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  };
  // Replace any existing outgoing edges from `activityId` with the
  // proposed set — `setPrerequisites` is a wholesale replace, not an
  // incremental add.
  for (const edge of existingEdges) {
    if (edge.activityId === activityId) continue;
    addEdge(edge.activityId, edge.prerequisiteActivityId);
  }
  for (const prereq of prerequisiteActivityIds) {
    addEdge(activityId, prereq);
  }

  // DFS from each node tracking gray (in-progress) vs black (finished).
  // A back-edge to a gray node is a cycle.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const allNodes = new Set<string>();
  for (const e of existingEdges) {
    allNodes.add(e.activityId);
    allNodes.add(e.prerequisiteActivityId);
  }
  for (const p of prerequisiteActivityIds) allNodes.add(p);
  allNodes.add(activityId);
  for (const n of allNodes) color.set(n, WHITE);

  const visit = (start: string): boolean => {
    const stack: Array<{ node: string; iter: number }> = [{ node: start, iter: 0 }];
    color.set(start, GRAY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { node: string; iter: number };
      const adj = adjacency.get(frame.node) ?? [];
      if (frame.iter >= adj.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const next = adj[frame.iter] as string;
      frame.iter += 1;
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE) {
        color.set(next, GRAY);
        stack.push({ node: next, iter: 0 });
      }
    }
    return false;
  };

  for (const n of allNodes) {
    if (color.get(n) === WHITE) {
      if (visit(n)) {
        return fail(
          "cross_activity_prereq_cycle",
          "Activity prerequisites would create a cycle across activities.",
        );
      }
    }
  }
  return ok();
}
