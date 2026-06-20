import {
  type ActivityPartId,
  DomainError,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import { type GradedQuiz, gradeQuiz } from "./_lib/grade-quiz.ts";
import { type LoadOwnRecordDeps, loadOwnRecordContext } from "./_lib/load-own-record-context.ts";

export type GradeQuizAnswersInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly partId: string;
};

/** `null` when the participant has no persisted answers yet for this quiz —
 * the Player renders the ungraded prompt rather than a stale verdict. */
export type GradeQuizAnswersResult = GradedQuiz | null;

export type GradeQuizAnswersDeps = LoadOwnRecordDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * Re-grade a quiz Part's PERSISTED answers without writing. Backs the
 * Player's mount-time verdict rehydration: the per-question verdict + score
 * are derived server-side from the stored answers + the answer key (which
 * stays redacted from the client), so a refreshed Player can show the grade
 * again. A READ — no `assertActivityWritable` gate (a learner may review a
 * past grade after the window closes) and deliberately no `savePartProgress`
 * (a re-grade on every mount must not consume a D1 write, which would breach
 * the ≤ 50-write/user/day budget behind the $0 guarantee). Returns `null`
 * when nothing is stored.
 */
export async function gradeQuizAnswers(
  input: GradeQuizAnswersInput,
  deps: GradeQuizAnswersDeps,
): Promise<GradeQuizAnswersResult> {
  const ctx = await loadOwnRecordContext(input.actor, input.activityId, deps);
  const part = ctx.activity.parts.find((p) => p.id === input.partId);
  if (!part) {
    throw new DomainError("NOT_FOUND", "Part not found.", "not_found");
  }
  if (part.kind !== "quiz") {
    throw new DomainError("INVARIANT_VIOLATION", "Part is not a quiz Part.", "part_kind_mismatch");
  }

  const record = await deps.records.byParticipantAndActivity(input.activityId, input.actor);
  if (!record) return null;
  const existing = await deps.records.getPartProgress({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
  });
  if (existing?.state.kind !== "quiz" || existing.state.answers.length === 0) return null;

  return gradeQuiz(part, existing.state.answers);
}
