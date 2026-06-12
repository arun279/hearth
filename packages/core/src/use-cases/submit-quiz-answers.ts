import {
  type ActivityPartId,
  DomainError,
  evaluateQuizAnswer,
  type LearningActivityId,
  type QuizAnswer,
  type QuizVerdict,
  type UserId,
} from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import {
  type LoadWritableOwnPartDeps,
  loadWritableOwnPart,
} from "./_lib/load-own-record-context.ts";

export type SubmitQuizAnswersInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly partId: string;
  readonly answers: readonly QuizAnswer[];
};

export type SubmitQuizAnswersResult = {
  readonly perQuestion: ReadonlyArray<{
    readonly questionId: string;
    readonly verdict: QuizVerdict;
    /** The keyed correct option for a multiple-choice question, revealed
     * only here (after the learner has answered) so the SPA can highlight
     * it. `null` for short-answer or ungraded questions. */
    readonly correctIndex: number | null;
  }>;
  /** Honor-system score: `correct` of the `gradeable` (keyed) questions.
   * Ungraded (`no_key`) questions are excluded from the denominator. */
  readonly autoScore: { readonly correct: number; readonly gradeable: number };
};

export type SubmitQuizAnswersDeps = LoadWritableOwnPartDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * Submit (or re-submit) a quiz Part. Own-record only. Grades each answer via
 * the pure `evaluateQuizAnswer`, persists the answers (latest wins; preserves
 * `completed`), and returns per-question verdicts + an aggregate score.
 * Grading is honor-system and fail-soft — an ungraded question never blocks
 * the learner.
 */
export async function submitQuizAnswers(
  input: SubmitQuizAnswersInput,
  deps: SubmitQuizAnswersDeps,
): Promise<SubmitQuizAnswersResult> {
  const part = await loadWritableOwnPart(
    { actor: input.actor, activityId: input.activityId, partId: input.partId },
    "quiz",
    deps,
  );

  // The submission must line up 1:1 with the authored questions: same count,
  // every answer keyed to a real question, kinds aligned. A mismatch is a
  // malformed submission, not a grade.
  const questionById = new Map(part.questions.map((q) => [q.id, q] as const));
  if (input.answers.length !== part.questions.length) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Answer count does not match the quiz.",
      "quiz_answers_mismatch",
    );
  }
  const answerById = new Map<string, QuizAnswer>();
  for (const a of input.answers) {
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
    // The wire schema caps `selectedIndex` at the global option max, not
    // the question's actual option count — reject an index that points
    // past this question's options as a malformed submission rather than
    // silently grading it incorrect.
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

  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
  });
  const existing = await deps.records.getPartProgress({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
  });
  const completed = existing?.state.kind === "quiz" ? existing.state.completed : false;
  await deps.records.savePartProgress({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
    state: { kind: "quiz", completed, answers: [...input.answers] },
  });

  // TODO(m11): enqueue `answers_submitted` + `last_answered_at` + `auto_score`
  // Evidence Signals here (same M11-declares-port / M17-batcher deferral rationale
  // as saveReflectionDraft). Values (`correct`, `gradeable`) are already computed.
  return { perQuestion, autoScore: { correct, gradeable } };
}
