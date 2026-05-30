import {
  type ActivityPartId,
  arePartPrerequisitesMet,
  computeActivityAccessState,
  DomainError,
  evaluateQuizAnswer,
  type LearningActivityId,
  type PartProgress,
  type PartProgressState,
  type QuizAnswer,
  type QuizSubmission,
  type UserId,
} from "@hearth/domain";
import { canMarkPartComplete } from "@hearth/domain/policy/can-mark-part-complete";
import type {
  ActivityRecordRepository,
  Clock,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

export type SubmitQuizAnswersInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly partId: ActivityPartId;
  readonly submission: QuizSubmission;
};

export type SubmitQuizAnswersDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
  readonly clock: Clock;
};

export type SubmitQuizAnswersResult = {
  readonly partProgress: PartProgress;
};

/**
 * Grade a quiz submission server-side and persist the result. The answer key
 * never leaves the server: each response is graded against the question's key
 * here, and only the graded `QuizAnswer[]` (with the post-answer reveal) is
 * stored. Re-submission preserves the prior attempt — `snapshotPriorAsRetry`
 * archives it into Part History before this attempt overwrites the progress.
 */
export async function submitQuizAnswers(
  input: SubmitQuizAnswersInput,
  deps: SubmitQuizAnswersDeps,
): Promise<SubmitQuizAnswersResult> {
  const ctx = await loadViewableActivity(input.actor, input.activityId, deps);
  const part = ctx.activity.parts.find((p) => p.id === input.partId);
  if (!part) {
    throw new DomainError("NOT_FOUND", "Part not found on this activity.", "part_not_found");
  }
  if (part.kind !== "quiz") {
    throw new DomainError("INVARIANT_VIOLATION", "This Part is not a quiz.", "part_kind_mismatch");
  }

  const now = deps.clock.now();
  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
    now,
  });

  const priorProgress = await deps.records.listPartProgress(record.id);
  const completedOtherPartIds = new Set(
    priorProgress
      .filter((p) => p.partId !== input.partId && p.state.completed)
      .map((p) => p.partId),
  );
  const prerequisitesMet = arePartPrerequisitesMet(
    ctx.activity.flow,
    input.partId,
    completedOtherPartIds,
  );
  const accessState = computeActivityAccessState(
    ctx.activity.window,
    ctx.activity.postClosePolicy,
    now,
  );

  const verdict = canMarkPartComplete(ctx.actor, record, accessState, prerequisitesMet);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const answers: QuizAnswer[] = input.submission.answers.map((submitted) => {
    const question = part.questions.find((q) => q.id === submitted.questionId);
    if (!question) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Question ${submitted.questionId} is not part of this quiz.`,
        "quiz_question_unknown",
      );
    }
    return {
      questionId: submitted.questionId,
      response: submitted.response,
      result: evaluateQuizAnswer(question, submitted.response),
      correctIndex:
        question.shape.kind === "multiple_choice" ? question.shape.answerKeyIndex : undefined,
      explanation: question.explainAfterAnswer,
    };
  });

  const priorThisPart = priorProgress.find((p) => p.partId === input.partId);
  const state: PartProgressState = {
    kind: "quiz",
    completed: priorThisPart?.state.completed ?? false,
    answers,
  };

  const partProgress = await deps.records.savePartProgress({
    activityRecordId: record.id,
    partId: input.partId,
    state,
    now,
    snapshotPriorAsRetry: true,
  });

  return { partProgress };
}
