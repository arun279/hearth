import { describe, expect, it } from "vitest";
import type {
  ActivityPartId,
  ActivityRecordId,
  LearningActivityId,
  UserId,
} from "../../src/ids.ts";
import { projectRecordFull } from "../../src/record/projection.ts";
import type { ActivityRecord, PartProgress } from "../../src/record/types.ts";

const now = new Date("2026-06-01T00:00:00.000Z");
const later = new Date("2026-06-02T00:00:00.000Z");

const record: ActivityRecord = {
  id: "ar_1" as ActivityRecordId,
  activityId: "a_1" as LearningActivityId,
  participantId: "u_1" as UserId,
  completionState: "completed",
  completedAt: later,
  visibilityOverride: "track_only",
  createdAt: now,
  updatedAt: later,
};

const progress: readonly PartProgress[] = [
  {
    id: "pp_1",
    activityRecordId: "ar_1" as ActivityRecordId,
    partId: "p1" as ActivityPartId,
    state: { kind: "write_reflection", completed: true, text: "done" },
    updatedAt: later,
  },
  {
    id: "pp_2",
    activityRecordId: "ar_1" as ActivityRecordId,
    partId: "p2" as ActivityPartId,
    state: { kind: "read_library_item", completed: false },
    updatedAt: now,
  },
];

describe("projectRecordFull", () => {
  it("assembles the full view from record + progress + history aggregates", () => {
    const view = projectRecordFull({
      record,
      progress,
      partHistoryCount: 3,
      partsWithHistory: ["p1" as ActivityPartId],
    });

    expect(view).toEqual({
      id: "ar_1",
      activityId: "a_1",
      participantId: "u_1",
      completionState: "completed",
      completedAt: later,
      visibilityOverride: "track_only",
      createdAt: now,
      updatedAt: later,
      parts: [
        {
          partId: "p1",
          state: { kind: "write_reflection", completed: true, text: "done" },
          updatedAt: later,
        },
        {
          partId: "p2",
          state: { kind: "read_library_item", completed: false },
          updatedAt: now,
        },
      ],
      partHistoryCount: 3,
      partsWithHistory: ["p1"],
    });
  });

  it("carries a zero history count and empty parts list", () => {
    const view = projectRecordFull({
      record,
      progress: [],
      partHistoryCount: 0,
      partsWithHistory: [],
    });
    expect(view.parts).toEqual([]);
    expect(view.partHistoryCount).toBe(0);
    expect(view.partsWithHistory).toEqual([]);
  });
});
