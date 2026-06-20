import { describe, expect, it } from "vitest";
import type { LearningActivity } from "../../src/activity/types.ts";
import type { LearningActivityId, LearningTrackId } from "../../src/ids.ts";
import type { ActivityPart } from "../../src/parts/index.ts";
import { affectedPartIdsForRevisionBump } from "../../src/record/affected-parts.ts";

const now = new Date("2026-06-01T00:00:00.000Z");

function activityWith(parts: readonly ActivityPart[]): LearningActivity {
  return {
    id: "a_1" as LearningActivityId,
    trackId: "t_1" as LearningTrackId,
    title: "A",
    description: null,
    parts,
    flow: { prereqs: [] },
    audience: { kind: "everyone_enrolled" },
    window: null,
    postClosePolicy: null,
    completionRule: { kind: "manual_mark" },
    participationMode: "individual",
    libraryRefs: [],
    prerequisiteActivityIds: [],
    suggestedNextActivityIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("affectedPartIdsForRevisionBump", () => {
  it("flags an unpinned read_library_item Part whose item's current revision changed", () => {
    const activity = activityWith([{ kind: "read_library_item", id: "p1", libraryItemId: "li1" }]);
    const result = affectedPartIdsForRevisionBump(
      activity,
      new Map([["li1", "rev_a"]]),
      new Map([["li1", "rev_b"]]),
    );
    expect(result).toEqual(["p1"]);
  });

  it("flags unpinned listen_audio and watch_video Parts whose revision changed", () => {
    const activity = activityWith([
      { kind: "listen_audio", id: "pa", libraryItemId: "li_audio" },
      { kind: "watch_video", id: "pv", libraryItemId: "li_video" },
    ]);
    const result = affectedPartIdsForRevisionBump(
      activity,
      new Map([
        ["li_audio", "rev_a"],
        ["li_video", "rev_a"],
      ]),
      new Map([
        ["li_audio", "rev_b"],
        ["li_video", "rev_b"],
      ]),
    );
    expect(result).toEqual(["pa", "pv"]);
  });

  it("excludes a Part whose item revision is unchanged (idempotent re-bump → empty)", () => {
    const activity = activityWith([{ kind: "read_library_item", id: "p1", libraryItemId: "li1" }]);
    const result = affectedPartIdsForRevisionBump(
      activity,
      new Map([["li1", "rev_a"]]),
      new Map([["li1", "rev_a"]]),
    );
    expect(result).toEqual([]);
  });

  it("excludes a pinned Library-backed Part even when the item's current revision changed", () => {
    const activity = activityWith([
      { kind: "read_library_item", id: "p1", libraryItemId: "li1", pinnedRevisionId: "rev_pin" },
    ]);
    const result = affectedPartIdsForRevisionBump(
      activity,
      new Map([["li1", "rev_a"]]),
      new Map([["li1", "rev_b"]]),
    );
    expect(result).toEqual([]);
  });

  it("excludes non-Library-backed Parts (reflection, quiz, embed, attend_session)", () => {
    const activity = activityWith([
      { kind: "write_reflection", id: "pr", prompt: "Why?" },
      {
        kind: "quiz",
        id: "pq",
        questions: [
          {
            id: "q1",
            prompt: "?",
            shape: { kind: "short_answer", alsoAccept: [], exactMatch: false },
          },
        ],
      },
      { kind: "embed", id: "pe", url: "https://example.com", provider: "generic" },
      { kind: "attend_session", id: "ps", studySessionId: "s1" },
    ]);
    const result = affectedPartIdsForRevisionBump(activity, new Map(), new Map());
    expect(result).toEqual([]);
  });

  it("treats a missing map entry as null and flags a newly-resolvable item", () => {
    const activity = activityWith([{ kind: "read_library_item", id: "p1", libraryItemId: "li1" }]);
    const result = affectedPartIdsForRevisionBump(activity, new Map(), new Map([["li1", "rev_b"]]));
    expect(result).toEqual(["p1"]);
  });

  it("returns affected ids in activity Part order across a mixed Flow", () => {
    const activity = activityWith([
      { kind: "write_reflection", id: "p_reflect", prompt: "?" },
      { kind: "read_library_item", id: "p_read", libraryItemId: "li1" },
      { kind: "watch_video", id: "p_watch", libraryItemId: "li2", pinnedRevisionId: "rev_pin" },
      { kind: "listen_audio", id: "p_audio", libraryItemId: "li3" },
    ]);
    const result = affectedPartIdsForRevisionBump(
      activity,
      new Map([
        ["li1", "rev_a"],
        ["li2", "rev_a"],
        ["li3", "rev_a"],
      ]),
      new Map([
        ["li1", "rev_b"],
        ["li2", "rev_b"],
        ["li3", "rev_b"],
      ]),
    );
    expect(result).toEqual(["p_read", "p_audio"]);
  });
});
