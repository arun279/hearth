import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PART_KINDS,
  activityPartSchema,
  attendSessionPartSchema,
  embedPartSchema,
  listenAudioPartSchema,
  quizPartSchema,
  readLibraryItemPartSchema,
  watchVideoPartSchema,
  writeReflectionPartSchema,
} from "../../src/parts/index.ts";

const READ: unknown = {
  kind: "read_library_item",
  id: "p1",
  libraryItemId: "li1",
  pinnedRevisionId: "rev1",
  title: "Chapter 1",
};

const LISTEN: unknown = {
  kind: "listen_audio",
  id: "p2",
  libraryItemId: "li2",
  startSeconds: 5,
  endSeconds: 60,
};

const WATCH: unknown = {
  kind: "watch_video",
  id: "p3",
  libraryItemId: "li3",
  startSeconds: 0,
};

const REFLECT: unknown = {
  kind: "write_reflection",
  id: "p4",
  prompt: "What did you learn?",
  minWords: 10,
};

const QUIZ: unknown = {
  kind: "quiz",
  id: "p5",
  questions: [
    {
      id: "q1",
      prompt: "Pick one",
      shape: { kind: "multiple_choice", options: ["a", "b", "c"], answerKeyIndex: 1 },
    },
    {
      id: "q2",
      prompt: "Type one",
      shape: { kind: "short_answer", correctAnswer: "yes", alsoAccept: ["yep"], exactMatch: false },
    },
  ],
};

const ATTEND: unknown = { kind: "attend_session", id: "p6", studySessionId: "s1" };
const EMBED: unknown = {
  kind: "embed",
  id: "p7",
  provider: "youtube",
  url: "https://youtube.com/embed/x",
};

describe("ACTIVITY_PART_KINDS", () => {
  it("has exactly the canonical seven", () => {
    expect([...ACTIVITY_PART_KINDS].sort()).toEqual([
      "attend_session",
      "embed",
      "listen_audio",
      "quiz",
      "read_library_item",
      "watch_video",
      "write_reflection",
    ]);
  });
});

describe("Per-Part schemas accept canonical inputs", () => {
  const cases: ReadonlyArray<
    readonly [
      string,
      ReturnType<typeof activityPartSchema.safeParse>["error"] extends never ? never : unknown,
      unknown,
    ]
  > = [
    ["read_library_item", readLibraryItemPartSchema, READ],
    ["listen_audio", listenAudioPartSchema, LISTEN],
    ["watch_video", watchVideoPartSchema, WATCH],
    ["write_reflection", writeReflectionPartSchema, REFLECT],
    ["quiz", quizPartSchema, QUIZ],
    ["attend_session", attendSessionPartSchema, ATTEND],
    ["embed", embedPartSchema, EMBED],
  ] as const;
  it.each(cases)("%s accepts a canonical fixture", (_name, schema, fixture) => {
    expect(() => (schema as { parse: (x: unknown) => unknown }).parse(fixture)).not.toThrow();
  });
});

describe("activityPartSchema (discriminated union)", () => {
  it.each([
    ["read_library_item", READ],
    ["listen_audio", LISTEN],
    ["watch_video", WATCH],
    ["write_reflection", REFLECT],
    ["quiz", QUIZ],
    ["attend_session", ATTEND],
    ["embed", EMBED],
  ])("accepts a %s part", (_name, fixture) => {
    expect(() => activityPartSchema.parse(fixture)).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() => activityPartSchema.parse({ kind: "unsupported_kind_v2", id: "p1" })).toThrow();
  });

  it("rejects a quiz with answerKeyIndex out of bounds", () => {
    expect(() =>
      activityPartSchema.parse({
        kind: "quiz",
        id: "p1",
        questions: [
          {
            id: "q",
            prompt: "p",
            shape: { kind: "multiple_choice", options: ["a", "b"], answerKeyIndex: 5 },
          },
        ],
      }),
    ).toThrow();
  });

  const shortAnswerQuiz = (shape: unknown): unknown => ({
    kind: "quiz",
    id: "p1",
    questions: [{ id: "q", prompt: "p", shape }],
  });

  it("defaults short_answer alsoAccept to [] and exactMatch to false", () => {
    const parsed = quizPartSchema.parse(shortAnswerQuiz({ kind: "short_answer" }));
    expect(parsed.questions[0]?.shape).toEqual({
      kind: "short_answer",
      alsoAccept: [],
      exactMatch: false,
    });
  });

  it("rejects short_answer with a non-empty alsoAccept but no correctAnswer", () => {
    expect(() =>
      activityPartSchema.parse(shortAnswerQuiz({ kind: "short_answer", alsoAccept: ["yes"] })),
    ).toThrow();
  });

  it("rejects a whitespace-only correctAnswer", () => {
    expect(() =>
      activityPartSchema.parse(shortAnswerQuiz({ kind: "short_answer", correctAnswer: "   " })),
    ).toThrow();
  });

  it("rejects an alsoAccept list past the per-question cap", () => {
    const overflow = Array.from({ length: 11 }, (_, i) => `alt${i}`);
    expect(() =>
      activityPartSchema.parse(
        shortAnswerQuiz({ kind: "short_answer", correctAnswer: "yes", alsoAccept: overflow }),
      ),
    ).toThrow();
  });

  it("rejects an audio part with endSeconds < startSeconds", () => {
    expect(() =>
      activityPartSchema.parse({
        kind: "listen_audio",
        id: "p",
        libraryItemId: "li",
        startSeconds: 60,
        endSeconds: 30,
      }),
    ).toThrow();
  });

  it("rejects an embed with non-https URL", () => {
    expect(() =>
      activityPartSchema.parse({
        kind: "embed",
        id: "p",
        provider: "generic",
        url: "http://example.com/embed",
      }),
    ).toThrow();
  });
});
