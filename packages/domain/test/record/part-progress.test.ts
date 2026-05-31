import { describe, expect, it } from "vitest";
import type { ActivityPart } from "../../src/parts/index.ts";
import {
  initialPartProgressState,
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
      questions: [{ id: "q1", prompt: "?", shape: { kind: "short_answer" } }],
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

  it("rejects a state whose discriminator is unknown", () => {
    expect(() => partProgressStateSchema.parse({ kind: "nope", completed: false })).toThrow();
  });
});
