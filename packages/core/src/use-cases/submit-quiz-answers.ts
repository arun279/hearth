import type { ActivityPartId, LearningActivityId, QuizAnswer, UserId } from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import { type GradedQuiz, gradeQuiz } from "./_lib/grade-quiz.ts";
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

export type SubmitQuizAnswersResult = GradedQuiz;

export type SubmitQuizAnswersDeps = LoadWritableOwnPartDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * Submit (or re-submit) a quiz Part. Own-record only. Grades each answer via
 * the pure `gradeQuiz`, persists the answers (latest wins; preserves
 * `completed`), and returns per-question verdicts + an aggregate score.
 * Grading is honor-system and fail-soft — an ungraded question never blocks
 * the learner. Verdict rehydration on a later reload goes through the
 * grade-only `gradeQuizAnswers` path (no write), so a completed-quiz mount
 * costs zero D1 writes.
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

  const graded = gradeQuiz(part, input.answers);

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

  await deps.records.flushEvidenceSignals([
    {
      activityId: input.activityId,
      participantId: input.actor,
      partId: part.id as ActivityPartId,
      signalType: "answers_submitted",
      value: input.answers.length,
    },
    {
      activityId: input.activityId,
      participantId: input.actor,
      partId: part.id as ActivityPartId,
      signalType: "last_answered_at",
      value: deps.clock.now().toISOString(),
    },
    {
      activityId: input.activityId,
      participantId: input.actor,
      partId: part.id as ActivityPartId,
      signalType: "auto_score",
      value: graded.autoScore,
    },
  ]);

  return graded;
}
