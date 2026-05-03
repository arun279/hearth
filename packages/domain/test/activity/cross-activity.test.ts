import { describe, expect, it } from "vitest";
import { assertActivityPrerequisitesAcyclic } from "../../src/activity/cross-activity.ts";
import type { LearningActivityId } from "../../src/ids.ts";

const a = "a" as LearningActivityId;
const b = "b" as LearningActivityId;
const c = "c" as LearningActivityId;
const d = "d" as LearningActivityId;

describe("assertActivityPrerequisitesAcyclic", () => {
  it("ok on the empty graph", () => {
    expect(assertActivityPrerequisitesAcyclic(a, [], []).ok).toBe(true);
  });

  it("ok on a tree", () => {
    expect(
      assertActivityPrerequisitesAcyclic(b, [a], [{ activityId: c, prerequisiteActivityId: b }]).ok,
    ).toBe(true);
  });

  it("rejects self-edge", () => {
    const r = assertActivityPrerequisitesAcyclic(a, [a], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("cross_activity_prereq_cycle");
  });

  it("rejects a 2-cycle (b → a, a → b)", () => {
    const r = assertActivityPrerequisitesAcyclic(
      a,
      [b],
      [{ activityId: b, prerequisiteActivityId: a }],
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a 3-cycle (a → b → c → a)", () => {
    const r = assertActivityPrerequisitesAcyclic(
      a,
      [b],
      [
        { activityId: b, prerequisiteActivityId: c },
        { activityId: c, prerequisiteActivityId: a },
      ],
    );
    expect(r.ok).toBe(false);
  });

  it("post-replace: existing b → a + new a → c is acyclic", () => {
    const r = assertActivityPrerequisitesAcyclic(
      a,
      [c],
      [
        { activityId: a, prerequisiteActivityId: b }, // replaced
        { activityId: b, prerequisiteActivityId: a },
      ],
    );
    expect(r.ok).toBe(true);
  });

  it("ok on a long chain", () => {
    const r = assertActivityPrerequisitesAcyclic(
      d,
      [c],
      [
        { activityId: c, prerequisiteActivityId: b },
        { activityId: b, prerequisiteActivityId: a },
      ],
    );
    expect(r.ok).toBe(true);
  });
});
