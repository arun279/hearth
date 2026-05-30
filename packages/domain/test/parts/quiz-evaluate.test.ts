import { describe, expect, it } from "vitest";
import type { QuizQuestion } from "../../src/parts/quiz.ts";
import { evaluateQuizAnswer } from "../../src/parts/quiz-evaluate.ts";

const mc = (answerKeyIndex?: number): QuizQuestion => ({
  id: "q1",
  prompt: "Pick one",
  shape: { kind: "multiple_choice", options: ["a", "b", "c"], answerKeyIndex },
});

const sa = (answerKeyRegex?: string): QuizQuestion => ({
  id: "q2",
  prompt: "Type the answer",
  shape: { kind: "short_answer", answerKeyRegex },
});

describe("evaluateQuizAnswer — multiple choice", () => {
  it("grades the keyed option correct", () => {
    expect(evaluateQuizAnswer(mc(1), { kind: "multiple_choice", selectedIndex: 1 })).toBe(
      "correct",
    );
  });

  it("grades a non-keyed option incorrect", () => {
    expect(evaluateQuizAnswer(mc(1), { kind: "multiple_choice", selectedIndex: 0 })).toBe(
      "incorrect",
    );
  });

  it("is no_key when no answer key is authored", () => {
    expect(evaluateQuizAnswer(mc(), { kind: "multiple_choice", selectedIndex: 1 })).toBe("no_key");
  });

  it("is no_key on a response-shape mismatch", () => {
    expect(evaluateQuizAnswer(mc(1), { kind: "short_answer", text: "1" })).toBe("no_key");
  });
});

describe("evaluateQuizAnswer — short answer", () => {
  it("matches case-insensitively against the key", () => {
    expect(evaluateQuizAnswer(sa("^paris$"), { kind: "short_answer", text: "Paris" })).toBe(
      "correct",
    );
  });

  it("trims surrounding whitespace before matching", () => {
    expect(evaluateQuizAnswer(sa("^paris$"), { kind: "short_answer", text: "  paris  " })).toBe(
      "correct",
    );
  });

  it("grades a non-match incorrect", () => {
    expect(evaluateQuizAnswer(sa("^paris$"), { kind: "short_answer", text: "London" })).toBe(
      "incorrect",
    );
  });

  it("is no_key when no key is authored", () => {
    expect(evaluateQuizAnswer(sa(), { kind: "short_answer", text: "paris" })).toBe("no_key");
  });

  it("fails soft to no_key on an unsafe (ReDoS) key rather than evaluating it", () => {
    expect(evaluateQuizAnswer(sa("(a+)+$"), { kind: "short_answer", text: "aaaa" })).toBe("no_key");
  });

  it("fails soft to no_key on an unparseable key", () => {
    expect(evaluateQuizAnswer(sa("("), { kind: "short_answer", text: "x" })).toBe("no_key");
  });
});
