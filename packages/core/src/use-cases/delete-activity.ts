import { DomainError, type LearningActivityId, type UserId } from "@hearth/domain";
import { canDeleteLearningActivity } from "@hearth/domain/policy/can-delete-learning-activity";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

export type DeleteActivityInput = {
  readonly actor: UserId;
  readonly id: LearningActivityId;
};

export type DeleteActivityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Hard-delete an activity. Refused when:
 *   - any other activity holds this one as a prerequisite or suggested
 *     successor (cross-activity dangling reference would break the
 *     graph),
 *   - any `activity_records` reference the activity (M11's enforcement
 *     ships when records do; the adapter's transaction holds the line
 *     today via FK existence checks).
 *
 * The adapter raises `DomainError("CONFLICT", …, "activity_has_dependents")`
 * for the first; the route translates to RFC 7807 with the offending
 * activity titles in the detail so the SPA can render a useful refusal.
 */
export async function deleteActivity(
  input: DeleteActivityInput,
  deps: DeleteActivityDeps,
): Promise<void> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableActivity(
    input.actor,
    input.id,
    deps,
  );

  const verdict = canDeleteLearningActivity(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const dependents = await deps.activities.listDependentsOf(input.id);
  if (dependents.length > 0) {
    const titles = dependents.map((d) => d.title).join(", ");
    throw new DomainError(
      "CONFLICT",
      `Cannot delete: still required by ${titles}.`,
      "activity_has_dependents",
    );
  }

  await deps.activities.delete({ id: input.id, by: input.actor });
}
