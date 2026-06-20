import {
  DomainError,
  evaluateQuizAnswer,
  type QuizAnswer,
  type QuizPart,
  type QuizVerdict,
} from "@hearth/domain";

export type GradedQuiz = {
  readonly perQuestion: ReadonlyArray<{
    readonly questionId: string;
    readonly verdict: QuizVerdict;
    /** The keyed correct option for a multiple-choice question, revealed
     * only after the learner has answered so the SPA can highlight it.
     * `null` for short-answer or ungraded questions. */
    readonly correctIndex: number | null;
  }>;
  /** Honor-system score: `correct` of the `gradeable` (keyed) questions.
   * Ungraded (`no_key`) questions are excluded from the denominator. */
  readonly autoScore: { readonly correct: number; readonly gradeable: number };
};

/**
 * Validate a quiz submission against its authored questions, then grade it.
 * Pure given (part, answers) — shared by `submit-quiz-answers` (grade + persist)
 * and `grade-quiz-answers` (grade-only, for the Player's mount-time verdict
 * rehydration). Throws `quiz_answers_mismatch` on a malformed submission;
 * grading itself is fail-soft (an ungraded question is `no_key`, never an
 * error). Answer keys stay server-side — only verdicts + the revealed
 * `correctIndex` cross the boundary.
 */
export function gradeQuiz(part: QuizPart, answers: readonly QuizAnswer[]): GradedQuiz {
  const questionById = new Map(part.questions.map((q) => [q.id, q] as const));
  if (answers.length !== part.questions.length) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Answer count does not match the quiz.",
      "quiz_answers_mismatch",
    );
  }
  const answerById = new Map<string, QuizAnswer>();
  for (const a of answers) {
    const q = questionById.get(a.questionId);
    if (!q) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `No question ${a.questionId} in this quiz.`,
        "quiz_answers_mismatch",
      );
    }
    if (q.shape.kind !== a.kind) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Answer kind does not match question ${a.questionId}.`,
        "quiz_answers_mismatch",
      );
    }
    // The wire schema caps `selectedIndex` at the global option max, not the
    // question's actual option count — reject an index that points past this
    // question's options as a malformed submission rather than silently
    // grading it incorrect.
    if (
      a.kind === "multiple_choice" &&
      a.selectedIndex !== null &&
      q.shape.kind === "multiple_choice" &&
      a.selectedIndex >= q.shape.options.length
    ) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Selected option ${a.selectedIndex} is out of range for question ${a.questionId}.`,
        "quiz_answers_mismatch",
      );
    }
    if (answerById.has(a.questionId)) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Duplicate answer for question ${a.questionId}.`,
        "quiz_answers_mismatch",
      );
    }
    answerById.set(a.questionId, a);
  }

  const perQuestion = part.questions.map((q) => ({
    questionId: q.id,
    verdict: evaluateQuizAnswer(q, answerById.get(q.id)),
    correctIndex: q.shape.kind === "multiple_choice" ? (q.shape.answerKeyIndex ?? null) : null,
  }));
  const gradeable = perQuestion.filter((v) => v.verdict !== "no_key").length;
  const correct = perQuestion.filter((v) => v.verdict === "correct").length;
  return { perQuestion, autoScore: { correct, gradeable } };
}
