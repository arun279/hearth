import type { LearningActivity, LearningActivityId, LearningTrackId } from "@hearth/domain";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityHeader } from "./activity-header.tsx";

/**
 * The completion track reflects how many Parts carry a completed Part Progress
 * row — not cursor position. The counter ("Part X of N") is position and may
 * advance with navigation; the track and "done" count only move with real
 * completion. These tests pin that separation so a future change can't quietly
 * conflate the two.
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

type HeaderOverrides = Partial<Parameters<typeof ActivityHeader>[0]>;

function render(overrides: HeaderOverrides = {}): string {
  return renderToString(
    <ActivityHeader
      activity={activity}
      accessState="open"
      currentPartIndex={0}
      totalParts={3}
      completedCount={0}
      isComplete={false}
      canMarkComplete={false}
      onMarkComplete={() => undefined}
      markCompletePending={false}
      {...overrides}
    />,
  );
}

describe("ActivityHeader completion track", () => {
  it("reads 0% when no Part is complete", () => {
    const html = render({ completedCount: 0, totalParts: 3 });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Activity completion"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain("width:0%");
    expect(html).toContain("0/3 done");
  });

  it("reflects the completed fraction (rounded n/total)", () => {
    const html = render({ completedCount: 2, totalParts: 3 });
    expect(html).toContain('aria-valuenow="67"');
    expect(html).toContain("width:67%");
    expect(html).toContain("2/3 done");
  });

  it("shows the Complete badge and 100% once the record is complete", () => {
    const html = render({ completedCount: 3, totalParts: 3, isComplete: true });
    expect(html).toContain("Complete");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("3/3 done");
  });

  it("the Part counter is position, not completion", () => {
    const html = render({ currentPartIndex: 1, totalParts: 3, completedCount: 0 });
    const stripped = html.replace(/<!--\s*-->/g, "");
    expect(stripped).toContain("Part 2 of 3");
    // Navigating to a later Part must not advance the completion value.
    expect(html).toContain('aria-valuenow="0"');
  });

  it("offers the manual-mark complete action only when allowed", () => {
    expect(render({ canMarkComplete: true })).toContain("Mark activity complete");
    expect(render({ canMarkComplete: false })).not.toContain("Mark activity complete");
  });

  it("zero-part edge: no divide-by-zero, reads 0%", () => {
    const html = render({ totalParts: 0, completedCount: 0 });
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain("0/1 done");
  });
});
