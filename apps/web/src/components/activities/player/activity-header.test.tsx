import type { LearningActivity, LearningActivityId, LearningTrackId } from "@hearth/domain";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityHeader } from "./activity-header.tsx";

/**
 * The completion track is driven by honor-system per-Part completion: it
 * fills to the share of completed Parts and never tracks cursor position
 * (which would lie). `aria-valuetext` carries the same "N of M Parts
 * complete" count a sighted user reads.
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
  it("holds at zero completion when no Part is complete, regardless of cursor", () => {
    for (const index of [0, 1, 2]) {
      const html = renderToString(
        <ActivityHeader
          activity={activity}
          accessState="open"
          currentPartIndex={index}
          totalParts={3}
          completedCount={0}
        />,
      );
      expect(html).toContain('role="progressbar"');
      expect(html).toContain('aria-label="Activity completion"');
      expect(html).toContain('aria-valuenow="0"');
      expect(html).toContain("width:0%");
      expect(html).toContain('aria-valuetext="0 of 3 Parts complete"');
    }
  });

  it("fills proportionally and reports the count when some Parts are complete", () => {
    const html = renderToString(
      <ActivityHeader
        activity={activity}
        accessState="open"
        currentPartIndex={0}
        totalParts={3}
        completedCount={2}
      />,
    );
    expect(html).toContain('aria-valuenow="67"');
    expect(html).toContain("width:67%");
    expect(html).toContain('aria-valuetext="2 of 3 Parts complete"');
    const stripped = html.replace(/<!--\s*-->/g, "");
    expect(stripped).toContain("2 of 3 Parts complete");
  });

  it("shows full completion when every Part is complete", () => {
    const html = renderToString(
      <ActivityHeader
        activity={activity}
        accessState="open"
        currentPartIndex={2}
        totalParts={3}
        completedCount={3}
      />,
    );
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("width:100%");
    expect(html).toContain('aria-valuetext="3 of 3 Parts complete"');
  });

  it("does not divide by zero on a zero-Part activity", () => {
    const html = renderToString(
      <ActivityHeader
        activity={activity}
        accessState="open"
        currentPartIndex={0}
        totalParts={0}
        completedCount={0}
      />,
    );
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuetext="0 of 0 Parts complete"');
  });

  it("renders the progress track at a readable height, not a hairline", () => {
    const html = renderToString(
      <ActivityHeader
        activity={activity}
        accessState="open"
        currentPartIndex={0}
        totalParts={3}
        completedCount={1}
      />,
    );
    // A 2px hairline doesn't read as a progress element; the track holds a
    // ~5px height. Pin the class so a future restyle can't silently shrink it
    // back below readability.
    expect(html).toContain("h-[5px]");
    expect(html).not.toContain("h-[2px]");
  });

  it("advances the position counter independently of completion", () => {
    const html = renderToString(
      <ActivityHeader
        activity={activity}
        accessState="open"
        currentPartIndex={1}
        totalParts={3}
        completedCount={0}
      />,
    );
    const stripped = html.replace(/<!--\s*-->/g, "");
    expect(stripped).toContain("Part 2 of 3");
  });
});
