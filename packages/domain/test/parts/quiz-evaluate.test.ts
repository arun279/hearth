import { describe, expect, it } from "vitest";
import {
  type QuizAnswer,
  type QuizPart,
  type QuizQuestion,
  redactQuizAnswerKeys,
} from "../../src/parts/quiz.ts";
import { evaluateQuizAnswer } from "../../src/parts/quiz-evaluate.ts";

// A stand-in for the injected regex engine. Production injects a
// linear-time matcher; the truth table only needs realistic match/throw
// behavior, so native RegExp is fine here.
const nativeMatch = (pattern: string, input: string): boolean => new RegExp(pattern).test(input);

const mc = (answerKeyIndex?: number): QuizQuestion => ({
  id: "q1",
  prompt: "Pick one",
  shape: { kind: "multiple_choice", options: ["a", "b", "c"], answerKeyIndex },
});

const sa = (answerKeyRegex?: string): QuizQuestion => ({
  id: "q1",
  prompt: "Type it",
  shape: { kind: "short_answer", answerKeyRegex },
});

const mcAnswer = (selectedIndex: number | null): QuizAnswer => ({
  questionId: "q1",
  kind: "multiple_choice",
  selectedIndex,
});

const saAnswer = (text: string): QuizAnswer => ({ questionId: "q1", kind: "short_answer", text });

describe("evaluateQuizAnswer — multiple choice", () => {
  it("correct when the selected index matches the key", () => {
    expect(evaluateQuizAnswer(mc(1), mcAnswer(1), nativeMatch)).toBe("correct");
  });

  it("incorrect when the selected index differs", () => {
    expect(evaluateQuizAnswer(mc(1), mcAnswer(0), nativeMatch)).toBe("incorrect");
  });

  it("incorrect when unanswered but a key exists", () => {
    expect(evaluateQuizAnswer(mc(1), mcAnswer(null), nativeMatch)).toBe("incorrect");
    expect(evaluateQuizAnswer(mc(1), undefined, nativeMatch)).toBe("incorrect");
  });

  it("no_key when the author left the question ungraded", () => {
    expect(evaluateQuizAnswer(mc(undefined), mcAnswer(0), nativeMatch)).toBe("no_key");
  });

  it("incorrect when the answer kind does not match the question", () => {
    expect(evaluateQuizAnswer(mc(1), saAnswer("1"), nativeMatch)).toBe("incorrect");
  });
});

describe("evaluateQuizAnswer — short answer", () => {
  it("correct when the trimmed answer matches the key regex", () => {
    expect(evaluateQuizAnswer(sa("^yes$"), saAnswer("  yes  "), nativeMatch)).toBe("correct");
  });

  it("incorrect when the answer does not match", () => {
    expect(evaluateQuizAnswer(sa("^yes$"), saAnswer("no"), nativeMatch)).toBe("incorrect");
  });

  it("incorrect when the answer is empty but a key exists", () => {
    expect(evaluateQuizAnswer(sa("^yes$"), saAnswer("   "), nativeMatch)).toBe("incorrect");
  });

  it("no_key when the author left no answer key", () => {
    expect(evaluateQuizAnswer(sa(undefined), saAnswer("yes"), nativeMatch)).toBe("no_key");
  });

  it("incorrect when the answer kind does not match the question", () => {
    expect(evaluateQuizAnswer(sa("^yes$"), mcAnswer(0), nativeMatch)).toBe("incorrect");
  });

  it("fails soft to no_key when the matcher throws on an uncompilable key", () => {
    const throwingKey = "("; // native RegExp throws; a real RE2 engine would too
    expect(evaluateQuizAnswer(sa(throwingKey), saAnswer("anything"), nativeMatch)).toBe("no_key");
  });
});

describe("redactQuizAnswerKeys", () => {
  it("strips answer keys but keeps prompts, options, and explanations", () => {
    const part: QuizPart = {
      kind: "quiz",
      id: "p1",
      questions: [
        {
          id: "q1",
          prompt: "MC",
          shape: { kind: "multiple_choice", options: ["a", "b"], answerKeyIndex: 1 },
          explainAfterAnswer: "because",
        },
        { id: "q2", prompt: "SA", shape: { kind: "short_answer", answerKeyRegex: "^yes$" } },
      ],
    };
    const redacted = redactQuizAnswerKeys(part);
    expect(redacted.questions[0]?.shape).toEqual({ kind: "multiple_choice", options: ["a", "b"] });
    expect(redacted.questions[0]?.explainAfterAnswer).toBe("because");
    expect(redacted.questions[1]?.shape).toEqual({ kind: "short_answer" });
    // Pure — the original part is untouched.
    expect((part.questions[0]?.shape as { answerKeyIndex?: number }).answerKeyIndex).toBe(1);
  });
});
