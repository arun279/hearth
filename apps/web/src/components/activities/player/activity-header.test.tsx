import type { LearningActivity, LearningActivityId, LearningTrackId } from "@hearth/domain";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityHeader } from "./activity-header.tsx";

/**
 * The completion track holds at 0% until per-Part completion state is
 * persisted. Showing cursor position as completion would lie to the
 * participant — the regression test guards the no-lie shape by
 * asserting `aria-valuenow="0"` no matter which Part is active. When a
 * real `partStatuses` projection lands, this test should evolve into
 * "0% when no part is complete; n% when n/total are complete."
 */
const activity: LearningActivity = {
  id: "a_test" as LearningActivityId,
  trackId: "t_test" as LearningTrackId,
  title: "Test",
  description: null,
  parts: [
    { kind: "write_reflection", id: "p1", prompt: "?" },
    { kind: "write_reflection", id: "p2", prompt: "?" },
    { kind: "write_reflection", id: "p3", prompt: "?" },
  ],
  flow: { prereqs: [], displayOrder: ["p1", "p2", "p3"] },
  audience: { kind: "everyone_enrolled" },
  window: null,
  postClosePolicy: null,
  completionRule: { kind: "manual_mark" },
  participationMode: "individual",
  libraryRefs: [],
  prerequisiteActivityIds: [],
  suggestedNextActivityIds: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("ActivityHeader completion track", () => {
  const cases = [
    { label: "first part", index: 0, total: 3 },
    { label: "middle part", index: 1, total: 3 },
    { label: "last part", index: 2, total: 3 },
    { label: "zero-part edge", index: 0, total: 0 },
  ];
  for (const { label, index, total } of cases) {
    it(`holds at zero completion on the ${label}`, () => {
      const html = renderToString(
        <ActivityHeader
          activity={activity}
          accessState="open"
          currentPartIndex={index}
          totalParts={total}
        />,
      );
      // Track itself is present (layout is reserved).
      expect(html).toContain('role="progressbar"');
      expect(html).toContain('aria-label="Activity completion"');
      // The completion value never advances with Part navigation —
      // until real completion data ships, the only honest value is 0.
      expect(html).toContain('aria-valuenow="0"');
      expect(html).toContain("width:0%");
      // Counter still advances (that IS position, not completion).
      // Strip React's inserted comment markers around text-node boundaries
      // so the assertion reads the rendered string, not the SSR wire shape.
      if (total > 0) {
        const stripped = html.replace(/<!--\s*-->/g, "");
        expect(stripped).toContain(`Part ${index + 1} of ${total}`);
      }
    });
  }
});
