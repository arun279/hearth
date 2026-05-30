import { describe, expect, it } from "vitest";
import { partProgressStateEnvelopeSchema, quizSubmissionSchema } from "../../src/record/state.ts";

describe("partProgressStateEnvelopeSchema", () => {
  it("round-trips a reflection state", () => {
    const value = {
      v: 1,
      data: { kind: "write_reflection", completed: true, text: "I learned X." },
    };
    expect(partProgressStateEnvelopeSchema.parse(value)).toEqual(value);
  });

  it("round-trips a graded quiz state", () => {
    const value = {
      v: 1,
      data: {
        kind: "quiz",
        completed: false,
        answers: [
          {
            questionId: "q1",
            response: { kind: "multiple_choice", selectedIndex: 2 },
            result: "correct",
            correctIndex: 2,
            explanation: "Because.",
          },
        ],
      },
    };
    expect(partProgressStateEnvelopeSchema.parse(value)).toEqual(value);
  });

  it("rejects an unknown envelope version", () => {
    const value = { v: 2, data: { kind: "read_library_item", completed: true } };
    expect(partProgressStateEnvelopeSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a reflection state missing its text", () => {
    const value = { v: 1, data: { kind: "write_reflection", completed: false } };
    expect(partProgressStateEnvelopeSchema.safeParse(value).success).toBe(false);
  });
});

describe("quizSubmissionSchema", () => {
  it("accepts mixed multiple-choice and short-answer responses", () => {
    const value = {
      answers: [
        { questionId: "q1", response: { kind: "multiple_choice", selectedIndex: 0 } },
        { questionId: "q2", response: { kind: "short_answer", text: "paris" } },
      ],
    };
    expect(quizSubmissionSchema.parse(value)).toEqual(value);
  });

  it("rejects an out-of-bounds selected index", () => {
    const value = {
      answers: [{ questionId: "q1", response: { kind: "multiple_choice", selectedIndex: 99 } }],
    };
    expect(quizSubmissionSchema.safeParse(value).success).toBe(false);
  });
});
