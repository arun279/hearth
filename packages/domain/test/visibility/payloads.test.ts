import { describe, expect, it } from "vitest";
import type {
  ActivityPartId,
  ActivityRecordId,
  LearningActivityId,
  UserId,
} from "../../src/ids.ts";
import { projectRecordFull } from "../../src/record/projection.ts";
import type { ActivityRecord, PartProgress } from "../../src/record/types.ts";
import { projectActivityRecord } from "../../src/visibility/payloads.ts";

const now = new Date("2026-06-01T00:00:00.000Z");
const later = new Date("2026-06-02T00:00:00.000Z");

const record: ActivityRecord = {
  id: "ar_1" as ActivityRecordId,
  activityId: "a_1" as LearningActivityId,
  participantId: "u_1" as UserId,
  completionState: "completed",
  completedAt: later,
  visibilityOverride: "private",
  createdAt: now,
  updatedAt: later,
};

const progress: readonly PartProgress[] = [
  {
    id: "pp_1",
    activityRecordId: "ar_1" as ActivityRecordId,
    partId: "p1" as ActivityPartId,
    state: { kind: "write_reflection", completed: true, text: "my private reflection" },
    updatedAt: later,
  },
];

const args = {
  record,
  progress,
  partHistoryCount: 2,
  partsWithHistory: ["p1" as ActivityPartId],
  participantDisplayName: "Sam",
} as const;

describe("projectActivityRecord", () => {
  it("returns null for the hidden scope", () => {
    expect(projectActivityRecord("hidden", args)).toBeNull();
  });

  it("wraps the full view with scope and the resolved display name", () => {
    const full = projectActivityRecord("full", args);
    expect(full).toEqual({
      scope: "full",
      participantDisplayName: "Sam",
      ...projectRecordFull({
        record,
        progress,
        partHistoryCount: 2,
        partsWithHistory: ["p1" as ActivityPartId],
      }),
    });
  });

  it("projects the summary to exactly the six existence-and-completion fields", () => {
    const summary = projectActivityRecord("summary", args);
    expect(summary).toEqual({
      scope: "summary",
      recordId: "ar_1",
      activityId: "a_1",
      participantId: "u_1",
      participantDisplayName: "Sam",
      completionState: "completed",
      completedAt: later,
    });
  });

  it("the summary carries no working state, history, or override", () => {
    const summary = projectActivityRecord("summary", args);
    expect(summary).not.toBeNull();
    for (const leaked of [
      "parts",
      "partProgress",
      "partHistoryCount",
      "partsWithHistory",
      "visibilityOverride",
      "createdAt",
      "updatedAt",
    ]) {
      expect(summary).not.toHaveProperty(leaked);
    }
    // The reflection text lives only inside `parts`; absence of that key proves
    // no quiz answers or reflection prose can serialize through a summary.
    expect(JSON.stringify(summary)).not.toContain("my private reflection");
  });
});
