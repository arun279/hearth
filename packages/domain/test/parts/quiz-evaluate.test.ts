import { describe, expect, it } from "vitest";
import {
  type QuizAnswer,
  type QuizPart,
  type QuizQuestion,
  redactQuizAnswerKeys,
} from "../../src/parts/quiz.ts";
import { evaluateQuizAnswer } from "../../src/parts/quiz-evaluate.ts";

const mc = (answerKeyIndex?: number): QuizQuestion => ({
  id: "q1",
  prompt: "Pick one",
  shape: { kind: "multiple_choice", options: ["a", "b", "c"], answerKeyIndex },
});

const sa = (
  shape: { correctAnswer?: string; alsoAccept?: string[]; exactMatch?: boolean } = {},
): QuizQuestion => ({
  id: "q1",
  prompt: "Type it",
  shape: {
    kind: "short_answer",
    correctAnswer: shape.correctAnswer,
    alsoAccept: shape.alsoAccept ?? [],
    exactMatch: shape.exactMatch ?? false,
  },
});

const mcAnswer = (selectedIndex: number | null): QuizAnswer => ({
  questionId: "q1",
  kind: "multiple_choice",
  selectedIndex,
});

const saAnswer = (text: string): QuizAnswer => ({ questionId: "q1", kind: "short_answer", text });

describe("evaluateQuizAnswer — multiple choice", () => {
  it("correct when the selected index matches the key", () => {
    expect(evaluateQuizAnswer(mc(1), mcAnswer(1))).toBe("correct");
  });

  it("incorrect when the selected index differs", () => {
    expect(evaluateQuizAnswer(mc(1), mcAnswer(0))).toBe("incorrect");
  });

  it("incorrect when unanswered but a key exists", () => {
    expect(evaluateQuizAnswer(mc(1), mcAnswer(null))).toBe("incorrect");
    expect(evaluateQuizAnswer(mc(1), undefined)).toBe("incorrect");
  });

  it("no_key when the author left the question ungraded", () => {
    expect(evaluateQuizAnswer(mc(undefined), mcAnswer(0))).toBe("no_key");
  });

  it("incorrect when the answer kind does not match the question", () => {
    expect(evaluateQuizAnswer(mc(1), saAnswer("1"))).toBe("incorrect");
  });
});

describe("evaluateQuizAnswer — short answer", () => {
  it("no_key when no correct answer is set", () => {
    expect(evaluateQuizAnswer(sa(), saAnswer("yes"))).toBe("no_key");
  });

  it("correct on an exact literal match", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "yes" }), saAnswer("yes"))).toBe("correct");
  });

  it("correct ignoring case (forgiving mode)", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "yes" }), saAnswer("YES"))).toBe("correct");
  });

  it("correct ignoring surrounding whitespace", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "yes" }), saAnswer("  yes  "))).toBe("correct");
  });

  it("collapses every internal whitespace run, not just the first (global flag)", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "a b c" }), saAnswer("a  b  c"))).toBe("correct");
  });

  it("does not collapse a space that splits a word", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "yes" }), saAnswer("y es"))).toBe("incorrect");
  });

  it("correct via accent folding (forgiving mode)", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "sí" }), saAnswer("si"))).toBe("correct");
    expect(evaluateQuizAnswer(sa({ correctAnswer: "café" }), saAnswer("cafe"))).toBe("correct");
  });

  it("correct via an alsoAccept alternate", () => {
    expect(
      evaluateQuizAnswer(sa({ correctAnswer: "sí", alsoAccept: ["yes", "yep"] }), saAnswer("yep")),
    ).toBe("correct");
  });

  it("exactMatch requires case + accents but still canonicalizes encoding", () => {
    const q = sa({ correctAnswer: "sí", exactMatch: true });
    expect(evaluateQuizAnswer(q, saAnswer("si"))).toBe("incorrect");
    expect(evaluateQuizAnswer(q, saAnswer("SÍ"))).toBe("incorrect");
    // Decomposed "s" + combining acute should match composed "sí" under NFC.
    expect(evaluateQuizAnswer(q, saAnswer("sí"))).toBe("correct");
  });

  it("incorrect when the answer is empty but a key exists", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "yes" }), saAnswer("   "))).toBe("incorrect");
  });

  it("incorrect when the answer does not match", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "yes" }), saAnswer("no"))).toBe("incorrect");
  });

  it("incorrect when the answer kind does not match the question", () => {
    expect(evaluateQuizAnswer(sa({ correctAnswer: "yes" }), mcAnswer(0))).toBe("incorrect");
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
        {
          id: "q2",
          prompt: "SA",
          shape: {
            kind: "short_answer",
            correctAnswer: "yes",
            alsoAccept: ["y"],
            exactMatch: true,
          },
        },
      ],
    };
    const redacted = redactQuizAnswerKeys(part);
    expect(redacted.questions[0]?.shape).toEqual({ kind: "multiple_choice", options: ["a", "b"] });
    expect(redacted.questions[0]?.explainAfterAnswer).toBe("because");
    // correctAnswer + the alsoAccept contents (the secret) are stripped; the
    // empty defaults remain so the shape stays schema-valid.
    expect(redacted.questions[1]?.shape).toEqual({
      kind: "short_answer",
      alsoAccept: [],
      exactMatch: false,
    });
    // Pure — the original part is untouched.
    expect((part.questions[0]?.shape as { answerKeyIndex?: number }).answerKeyIndex).toBe(1);
  });
});
