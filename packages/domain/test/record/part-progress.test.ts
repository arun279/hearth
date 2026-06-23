import { describe, expect, it } from "vitest";
import type { ActivityPart } from "../../src/parts/index.ts";
import {
  initialPartProgressState,
  initialPartProgressStateForKind,
  type PartProgressState,
  partProgressEnvelopeSchema,
  partProgressStateSchema,
} from "../../src/record/part-progress.ts";

describe("initialPartProgressState", () => {
  it("seeds an empty reflection with empty text and not-completed", () => {
    const part: ActivityPart = { kind: "write_reflection", id: "p1", prompt: "Why?" };
    expect(initialPartProgressState(part)).toEqual({
      kind: "write_reflection",
      completed: false,
      text: "",
    });
  });

  it("seeds an empty quiz with no answers", () => {
    const part: ActivityPart = {
      kind: "quiz",
      id: "p2",
      questions: [
        {
          id: "q1",
          prompt: "?",
          shape: { kind: "short_answer", alsoAccept: [], exactMatch: false },
        },
      ],
    };
    expect(initialPartProgressState(part)).toEqual({ kind: "quiz", completed: false, answers: [] });
  });

  it("seeds passive Parts with just the completed flag", () => {
    const part: ActivityPart = { kind: "read_library_item", id: "p3", libraryItemId: "li1" };
    expect(initialPartProgressState(part)).toEqual({
      kind: "read_library_item",
      completed: false,
    });
  });

  it("seeds listen_audio with just the completed flag", () => {
    const part: ActivityPart = { kind: "listen_audio", id: "p4", libraryItemId: "li2" };
    expect(initialPartProgressState(part)).toEqual({ kind: "listen_audio", completed: false });
  });

  it("seeds watch_video with just the completed flag", () => {
    const part: ActivityPart = { kind: "watch_video", id: "p5", libraryItemId: "li3" };
    expect(initialPartProgressState(part)).toEqual({ kind: "watch_video", completed: false });
  });

  it("seeds attend_session with just the completed flag", () => {
    const part: ActivityPart = { kind: "attend_session", id: "p6", studySessionId: "s1" };
    expect(initialPartProgressState(part)).toEqual({ kind: "attend_session", completed: false });
  });

  it("seeds embed with just the completed flag", () => {
    const part: ActivityPart = {
      kind: "embed",
      id: "p7",
      url: "https://example.com",
      provider: "generic",
    };
    expect(initialPartProgressState(part)).toEqual({ kind: "embed", completed: false });
  });
});

describe("initialPartProgressStateForKind", () => {
  const kinds: PartProgressState["kind"][] = [
    "read_library_item",
    "listen_audio",
    "watch_video",
    "write_reflection",
    "quiz",
    "attend_session",
    "embed",
  ];

  it.each(kinds)("seeds an initial %s state", (kind) => {
    const state = initialPartProgressStateForKind(kind);
    expect(state.kind).toBe(kind);
    expect(state.completed).toBe(false);
  });

  it("is the single source of truth the part-keyed variant delegates to", () => {
    const parts: ActivityPart[] = [
      { kind: "read_library_item", id: "p1", libraryItemId: "li1" },
      { kind: "listen_audio", id: "p2", libraryItemId: "li2" },
      { kind: "watch_video", id: "p3", libraryItemId: "li3" },
      { kind: "write_reflection", id: "p4", prompt: "Why?" },
      {
        kind: "quiz",
        id: "p5",
        questions: [
          {
            id: "q1",
            prompt: "?",
            shape: { kind: "short_answer", alsoAccept: [], exactMatch: false },
          },
        ],
      },
      { kind: "attend_session", id: "p6", studySessionId: "s1" },
      { kind: "embed", id: "p7", url: "https://example.com", provider: "generic" },
    ];
    for (const part of parts) {
      expect(initialPartProgressState(part)).toEqual(initialPartProgressStateForKind(part.kind));
    }
  });
});

describe("partProgressEnvelopeSchema", () => {
  it("round-trips a reflection state", () => {
    const env = { v: 1 as const, data: { kind: "write_reflection", completed: true, text: "hi" } };
    expect(partProgressEnvelopeSchema.parse(env)).toEqual(env);
  });

  it("round-trips a quiz state with answers", () => {
    const env = {
      v: 1 as const,
      data: {
        kind: "quiz",
        completed: false,
        answers: [{ questionId: "q1", kind: "multiple_choice", selectedIndex: 2 }],
      },
    };
    expect(partProgressEnvelopeSchema.parse(env)).toEqual(env);
  });

  it("rejects an envelope with a future version", () => {
    expect(
      partProgressEnvelopeSchema.safeParse({
        v: 2,
        data: { kind: "write_reflection", completed: true, text: "hi" },
      }).success,
    ).toBe(false);
  });

  it("rejects a state whose discriminator is unknown", () => {
    expect(() => partProgressStateSchema.parse({ kind: "nope", completed: false })).toThrow();
  });
});
