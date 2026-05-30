import { describe, expect, it } from "vitest";
import type { ActivityPart } from "../../src/parts/index.ts";
import { initialPartProgressState } from "../../src/record/initial-state.ts";

describe("initialPartProgressState", () => {
  it("starts every kind incomplete", () => {
    const parts: ActivityPart[] = [
      { kind: "read_library_item", id: "p1", libraryItemId: "li1" },
      { kind: "listen_audio", id: "p2", libraryItemId: "li2" },
      { kind: "watch_video", id: "p3", libraryItemId: "li3" },
      { kind: "attend_session", id: "p4", studySessionId: "s1" },
      { kind: "embed", id: "p5", provider: "youtube", url: "https://youtu.be/x" },
    ];
    for (const part of parts) {
      expect(initialPartProgressState(part)).toEqual({ kind: part.kind, completed: false });
    }
  });

  it("seeds reflection with empty text", () => {
    const part: ActivityPart = { kind: "write_reflection", id: "p6", prompt: "Why?" };
    expect(initialPartProgressState(part)).toEqual({
      kind: "write_reflection",
      completed: false,
      text: "",
    });
  });

  it("seeds quiz with no answers", () => {
    const part: ActivityPart = {
      kind: "quiz",
      id: "p7",
      questions: [
        { id: "q1", prompt: "Pick", shape: { kind: "multiple_choice", options: ["a", "b"] } },
      ],
    };
    expect(initialPartProgressState(part)).toEqual({ kind: "quiz", completed: false, answers: [] });
  });
});
