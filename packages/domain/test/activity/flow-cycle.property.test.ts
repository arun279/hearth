import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertActivityFlowAcyclic } from "../../src/activity/invariants.ts";
import type { ActivityFlow, ActivityFlowEdge } from "../../src/activity/types.ts";

const partIds = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const;

const acyclicHardEdges = (): fc.Arbitrary<readonly ActivityFlowEdge[]> =>
  fc
    .array(
      fc.tuple(
        fc.integer({ min: 0, max: partIds.length - 1 }),
        fc.integer({ min: 0, max: partIds.length - 1 }),
      ),
      { maxLength: 30 },
    )
    // Project each (i, j) onto an edge where i < j — a topologically valid
    // ordering by construction. Self-loops are filtered. The result is
    // guaranteed acyclic on the hard sub-DAG.
    .map((pairs) =>
      pairs
        .filter(([i, j]) => i !== j)
        .map(
          ([i, j]): ActivityFlowEdge => ({
            fromPartId: partIds[Math.min(i, j)] as string,
            toPartId: partIds[Math.max(i, j)] as string,
            kind: "hard",
          }),
        ),
    );

const cyclicHardEdges = (): fc.Arbitrary<readonly ActivityFlowEdge[]> =>
  fc
    // 3+ part subset; build a directed cycle through them.
    .uniqueArray(fc.constantFrom(...partIds), { minLength: 3, maxLength: 6 })
    .map((subset) =>
      subset.map(
        (id, i): ActivityFlowEdge => ({
          fromPartId: id as string,
          toPartId: subset[(i + 1) % subset.length] as string,
          kind: "hard",
        }),
      ),
    );

const softEdges = (): fc.Arbitrary<readonly ActivityFlowEdge[]> =>
  fc
    .array(fc.tuple(fc.constantFrom(...partIds), fc.constantFrom(...partIds)), { maxLength: 20 })
    .map((pairs) =>
      pairs
        .filter(([f, t]) => f !== t)
        .map(([f, t]): ActivityFlowEdge => ({ fromPartId: f, toPartId: t, kind: "soft" })),
    );

describe("assertActivityFlowAcyclic", () => {
  it("accepts every acyclic hard sub-DAG (with arbitrary soft edges, including soft cycles)", async () => {
    await fc.assert(
      fc.property(acyclicHardEdges(), softEdges(), (hard, soft) => {
        const flow: ActivityFlow = { prereqs: [...hard, ...soft] };
        const result = assertActivityFlowAcyclic(flow);
        return result.ok === true;
      }),
    );
  });

  it("rejects every cyclic hard sub-DAG with the offending edges in the detail", async () => {
    await fc.assert(
      fc.property(cyclicHardEdges(), softEdges(), (cyclic, soft) => {
        const flow: ActivityFlow = { prereqs: [...cyclic, ...soft] };
        const result = assertActivityFlowAcyclic(flow);
        if (result.ok) return false;
        return (
          result.code === "flow_cycle_detected" &&
          result.detail !== undefined &&
          result.detail.edges.length >= cyclic.length
        );
      }),
    );
  });

  it("trivially accepts the empty flow", () => {
    expect(assertActivityFlowAcyclic({ prereqs: [] }).ok).toBe(true);
  });

  it("accepts a flow with only soft edges, even soft cycles", () => {
    const flow: ActivityFlow = {
      prereqs: [
        { fromPartId: "a", toPartId: "b", kind: "soft" },
        { fromPartId: "b", toPartId: "a", kind: "soft" },
      ],
    };
    expect(assertActivityFlowAcyclic(flow).ok).toBe(true);
  });
});
