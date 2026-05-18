import {
  assertActivityPrerequisitesAcyclic,
  type CrossActivityEdge,
  DomainError,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import { canSetPrerequisites } from "@hearth/domain/policy/can-set-prerequisites";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadEditableActivityWithSiblings } from "./_lib/load-editable-activity-with-siblings.ts";

export type SetActivityPrerequisitesInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly prerequisiteActivityIds: readonly LearningActivityId[];
};

export type SetActivityPrerequisitesDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Replace the activity's hard prerequisite edges. Pre-checks the
 * cross-activity DAG cycle invariant against existing edges; the
 * adapter re-runs the same check inside its D1 transaction (defense
 * in depth — concurrent edits from another facilitator can't slip
 * through the gap between the use-case check and the write).
 *
 * Same-track refusal: a prereq must live on the same track. Cross-track
 * dependencies aren't supported in v1 — the SPA's selector only offers
 * sibling activities, but we re-check here so a non-route caller can't
 * forge one.
 */
export async function setActivityPrerequisites(
  input: SetActivityPrerequisitesInput,
  deps: SetActivityPrerequisitesDeps,
): Promise<readonly LearningActivityId[]> {
  const { siblings, siblingIds } = await loadEditableActivityWithSiblings(
    input.actor,
    input.activityId,
    canSetPrerequisites,
    deps,
  );

  for (const id of input.prerequisiteActivityIds) {
    if (!siblingIds.has(id)) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Prerequisite activity ${id} is not on the same track.`,
        "prereq_cross_track",
      );
    }
  }

  // Build the existing-edges view from the same-track activities. A
  // cross-track edge cannot land in this graph (the same-track check
  // above forbids it), so reading just same-track edges is sufficient
  // for the cycle check.
  const existingEdges: CrossActivityEdge[] = [];
  for (const a of siblings) {
    if (a.id === input.activityId) continue;
    const upstream = await deps.activities.listPrerequisitesFor(a.id);
    for (const u of upstream) {
      existingEdges.push({ activityId: a.id, prerequisiteActivityId: u });
    }
  }

  const cycle = assertActivityPrerequisitesAcyclic(
    input.activityId,
    input.prerequisiteActivityIds,
    existingEdges,
  );
  if (!cycle.ok) {
    throw new DomainError("INVARIANT_VIOLATION", cycle.message, cycle.code);
  }

  return deps.activities.setPrerequisites({
    activityId: input.activityId,
    prerequisiteActivityIds: input.prerequisiteActivityIds,
  });
}
