import {
  type LearningActivity,
  type LearningActivityId,
  redactQuizAnswerKeys,
  type UserId,
} from "@hearth/domain";
import { canEditLearningActivity } from "@hearth/domain/policy/can-edit-learning-activity";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

export type GetActivityInput = {
  readonly actor: UserId;
  readonly id: LearningActivityId;
};

export type GetActivityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Aggregate read for the activity-detail surface. Viewability is gated
 * through `loadViewableActivity` (non-viewers receive `NOT_FOUND`); full
 * visibility-scope projection (per-record `summary` vs `full`) is M12's
 * responsibility.
 *
 * Quiz answer keys are authoring data: only a caller with edit authority
 * (who composes the keys) receives the unredacted body. Every other viewer
 * gets the same body with `answerKeyIndex` / `answerKeyRegex` stripped, the
 * same redaction the `/player` projection applies — otherwise an enrolled
 * learner could read the keys off this route and bypass server-side grading.
 */
export async function getActivity(
  input: GetActivityInput,
  deps: GetActivityDeps,
): Promise<LearningActivity> {
  const ctx = await loadViewableActivity(input.actor, input.id, deps);
  const canEdit = canEditLearningActivity(
    ctx.actor,
    ctx.group,
    ctx.track,
    ctx.groupMembership,
    ctx.trackEnrollment,
  );
  if (canEdit.ok) return ctx.activity;
  return {
    ...ctx.activity,
    parts: ctx.activity.parts.map((p) => (p.kind === "quiz" ? redactQuizAnswerKeys(p) : p)),
  };
}
