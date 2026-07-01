import { describe, expect, it } from "vitest";
import type { ActivityRecordId, LearningActivityId, UserId } from "../../src/ids.ts";
import * as domain from "../../src/index.ts";
import { projectTrackProgressRow } from "../../src/record/progress.ts";
import type { ActivityRecord } from "../../src/record/types.ts";

const now = new Date("2026-06-01T00:00:00.000Z");
const later = new Date("2026-06-02T00:00:00.000Z");

const record: ActivityRecord = {
  id: "ar_1" as ActivityRecordId,
  activityId: "a_1" as LearningActivityId,
  participantId: "u_1" as UserId,
  completionState: "completed",
  completedAt: later,
  createdAt: now,
  updatedAt: later,
};

describe("projectTrackProgressRow", () => {
  it("projects the coarse completion fact with a facilitator retry count", () => {
    expect(
      projectTrackProgressRow({ record, participantDisplayName: "Sam", retryCount: 3 }),
    ).toEqual({
      recordId: "ar_1",
      activityId: "a_1",
      participantId: "u_1",
      participantDisplayName: "Sam",
      completionState: "completed",
      completedAt: later,
      retryCount: 3,
    });
  });

  it("nulls the retry count for a peer viewer", () => {
    const row = projectTrackProgressRow({
      record,
      participantDisplayName: "Sam",
      retryCount: null,
    });
    expect(row.retryCount).toBeNull();
  });

  it("carries no content keys — only existence-and-completion", () => {
    const row = projectTrackProgressRow({
      record,
      participantDisplayName: "Sam",
      retryCount: 1,
    });
    for (const leaked of ["parts", "partProgress", "partsWithHistory", "createdAt", "updatedAt"]) {
      expect(row).not.toHaveProperty(leaked);
    }
  });
});

// The cross-participant CONTENT engine (the full/summary/hidden resolver and
// its payload projector) was removed: no code path may read another
// participant's reflection prose, quiz answers, or part values. This guards
// against a future session silently re-exporting it from the domain barrel.
describe("cross-participant content engine stays removed", () => {
  it("the domain barrel exposes no record-scope resolver or payload projector", () => {
    expect(domain).not.toHaveProperty("resolveActivityRecordScope");
    expect(domain).not.toHaveProperty("projectActivityRecord");
  });
});
