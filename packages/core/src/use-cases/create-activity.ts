import {
  assertActivityPrerequisitesAcyclic,
  DomainError,
  type LearningActivity,
  type LearningActivityDraft,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import { canCreateLearningActivity } from "@hearth/domain/policy/can-create-learning-activity";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";
import { validateActivityDraft } from "./_lib/validate-activity-draft.ts";

export type CreateActivityInput = {
  readonly actor: UserId;
  readonly draft: LearningActivityDraft;
};

export type CreateActivityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Compose a new Learning Activity. Pure invariants run first; lookups
 * (Library Item state, audience enrollments, cross-activity prereq
 * cycle) follow only on a well-formed draft. Cross-activity cycles are
 * checked against the post-write graph state — adding an activity with
 * prerequisites that close a loop with existing edges aborts before
 * the row is written.
 */
export async function createActivity(
  input: CreateActivityInput,
  deps: CreateActivityDeps,
): Promise<LearningActivity> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.draft.trackId,
    deps,
  );

  const verdict = canCreateLearningActivity(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  await validateActivityDraft(input.draft, deps);

  if (input.draft.prerequisiteActivityIds.length > 0) {
    const dependents = await loadDependentEdges(
      deps.activities,
      input.draft.prerequisiteActivityIds,
    );
    // The new activity has no id yet; pass a synthetic-but-stable
    // pseudo-id so the cycle check treats this activity as a fresh
    // node. The repo regenerates the real id on insert. The id below
    // never lands in storage.
    const verdict = assertActivityPrerequisitesAcyclic(
      "__pending_create__" as LearningActivityId,
      input.draft.prerequisiteActivityIds,
      dependents,
    );
    if (!verdict.ok) {
      throw new DomainError("INVARIANT_VIOLATION", verdict.message, verdict.code);
    }
  }

  return deps.activities.create({ draft: input.draft, createdBy: input.actor });
}

async function loadDependentEdges(
  activities: LearningActivityRepository,
  prerequisiteActivityIds: readonly LearningActivityId[],
) {
  // Load existing prerequisite edges that touch any node in the
  // post-write graph: every prereq the new activity points at, plus
  // every activity that depends on those prereqs (one hop). One DAG
  // traversal across the union catches every reachable cycle that the
  // proposed edges could close.
  const visited = new Set<LearningActivityId>();
  const queue = [...prerequisiteActivityIds];
  const edges: Array<{
    activityId: LearningActivityId;
    prerequisiteActivityId: LearningActivityId;
  }> = [];
  while (queue.length > 0) {
    const next = queue.shift() as LearningActivityId;
    if (visited.has(next)) continue;
    visited.add(next);
    const upstream = await activities.listPrerequisitesFor(next);
    for (const u of upstream) {
      edges.push({ activityId: next, prerequisiteActivityId: u });
      if (!visited.has(u)) queue.push(u);
    }
  }
  return edges;
}
