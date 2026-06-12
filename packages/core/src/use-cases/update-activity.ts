import {
  type ActivityAudience,
  type ActivityWindow,
  assertActivityPrerequisitesAcyclic,
  type CompletionRule,
  type CrossActivityEdge,
  DomainError,
  type LearningActivity,
  type LearningActivityDraft,
  type LearningActivityId,
  type PostClosePolicy,
  type UserId,
} from "@hearth/domain";
import { canEditLearningActivity } from "@hearth/domain/policy/can-edit-learning-activity";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";
import { validateActivityDraft } from "./_lib/validate-activity-draft.ts";

export type UpdateActivityInput = {
  readonly actor: UserId;
  readonly id: LearningActivityId;
  readonly patch: {
    readonly title?: string;
    readonly description?: string | null;
    readonly parts?: LearningActivityDraft["parts"];
    readonly flow?: LearningActivityDraft["flow"];
    readonly audience?: ActivityAudience;
    readonly window?: ActivityWindow | null;
    readonly postClosePolicy?: PostClosePolicy | null;
    readonly completionRule?: CompletionRule;
    readonly libraryRefs?: LearningActivityDraft["libraryRefs"];
    readonly prerequisiteActivityIds?: readonly LearningActivityId[];
    readonly suggestedNextActivityIds?: readonly LearningActivityId[];
  };
};

export type UpdateActivityDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Atomic-save for the activity composer. The merged draft re-runs every
 * invariant via `validateActivityDraft`, so a "title only" or "audience
 * only" patch still gets full-shape validation against the activity's
 * current state. Cross-activity prereq cycles are pre-checked here; the
 * adapter re-runs the same check inside its batch (defense in depth —
 * concurrent edits cannot slip through the gap).
 *
 * Persistence is a single `update` call: the body row and whichever
 * child collections (library refs, prereqs, suggested-sequences) the
 * patch touched land in one D1 batch, so a mid-sequence failure rolls
 * the whole save back rather than leaving the body updated with stale
 * children. The call returns the assembled post-write aggregate.
 */
export async function updateActivity(
  input: UpdateActivityInput,
  deps: UpdateActivityDeps,
): Promise<LearningActivity> {
  const { actor, group, track, groupMembership, trackEnrollment, activity } =
    await loadViewableActivity(input.actor, input.id, deps);

  const verdict = canEditLearningActivity(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const merged: LearningActivityDraft = {
    trackId: activity.trackId,
    title: input.patch.title ?? activity.title,
    description:
      input.patch.description === undefined ? activity.description : input.patch.description,
    parts: input.patch.parts ?? activity.parts,
    flow: input.patch.flow ?? activity.flow,
    audience: input.patch.audience ?? activity.audience,
    window: input.patch.window === undefined ? activity.window : input.patch.window,
    postClosePolicy:
      input.patch.postClosePolicy === undefined
        ? activity.postClosePolicy
        : input.patch.postClosePolicy,
    completionRule: input.patch.completionRule ?? activity.completionRule,
    libraryRefs:
      input.patch.libraryRefs ??
      activity.libraryRefs.map((r) => ({
        libraryItemId: r.libraryItemId,
        pinnedRevisionId: r.pinnedRevisionId,
      })),
    prerequisiteActivityIds:
      input.patch.prerequisiteActivityIds ?? activity.prerequisiteActivityIds,
    suggestedNextActivityIds:
      input.patch.suggestedNextActivityIds ?? activity.suggestedNextActivityIds,
  };

  await validateActivityDraft(merged, deps);

  if (input.patch.prerequisiteActivityIds !== undefined) {
    await validateCrossActivityPrereqs(input.id, input.patch.prerequisiteActivityIds, deps);
  }

  if (input.patch.suggestedNextActivityIds !== undefined) {
    await assertSuggestedSequencesSameTrack(
      activity.trackId,
      input.id,
      input.patch.suggestedNextActivityIds,
      deps,
    );
  }

  const bodyPatch = {
    ...(input.patch.title !== undefined ? { title: merged.title } : {}),
    ...(input.patch.description !== undefined ? { description: merged.description } : {}),
    ...(input.patch.parts !== undefined ? { parts: merged.parts } : {}),
    ...(input.patch.flow !== undefined ? { flow: merged.flow } : {}),
    ...(input.patch.audience !== undefined ? { audience: merged.audience } : {}),
    ...(input.patch.window !== undefined ? { window: merged.window } : {}),
    ...(input.patch.postClosePolicy !== undefined
      ? { postClosePolicy: merged.postClosePolicy }
      : {}),
    ...(input.patch.completionRule !== undefined ? { completionRule: merged.completionRule } : {}),
  };

  const children = {
    ...(input.patch.libraryRefs !== undefined ? { libraryRefs: input.patch.libraryRefs } : {}),
    ...(input.patch.prerequisiteActivityIds !== undefined
      ? { prerequisites: input.patch.prerequisiteActivityIds }
      : {}),
    ...(input.patch.suggestedNextActivityIds !== undefined
      ? { suggestedSequences: input.patch.suggestedNextActivityIds }
      : {}),
  };

  // Nothing to persist (the patch carried no body field and no child
  // collection): hand back the current aggregate rather than issuing an
  // empty write.
  if (Object.keys(bodyPatch).length === 0 && Object.keys(children).length === 0) {
    const current = await deps.activities.byId(input.id);
    if (!current) {
      throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
    }
    return current;
  }

  // One atomic write: body + every patched child collection land in a
  // single D1 batch and `update` returns the assembled post-write shape.
  return deps.activities.update({
    id: input.id,
    patch: bodyPatch,
    children,
    by: input.actor,
  });
}

async function validateCrossActivityPrereqs(
  activityId: LearningActivityId,
  prerequisiteActivityIds: readonly LearningActivityId[],
  deps: { readonly activities: LearningActivityRepository },
): Promise<void> {
  for (const id of prerequisiteActivityIds) {
    if (id === activityId) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "An activity cannot list itself as a prerequisite.",
        "prereq_self_loop",
      );
    }
  }
  if (prerequisiteActivityIds.length === 0) return;

  // Look up the trackId of the activity we're patching, then fetch
  // siblings (same-track-only) and verify each proposed prereq is in
  // that set.
  const activity = await deps.activities.byId(activityId);
  if (!activity) {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }
  const siblings = await deps.activities.byTrack(activity.trackId);
  const siblingIds = new Set(siblings.map((s) => s.id));
  for (const id of prerequisiteActivityIds) {
    if (!siblingIds.has(id)) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Prerequisite activity ${id} is not on the same track.`,
        "prereq_cross_track",
      );
    }
  }

  const existingEdges: CrossActivityEdge[] = [];
  for (const a of siblings) {
    if (a.id === activityId) continue;
    const upstream = await deps.activities.listPrerequisitesFor(a.id);
    for (const u of upstream) {
      existingEdges.push({ activityId: a.id, prerequisiteActivityId: u });
    }
  }
  const cycle = assertActivityPrerequisitesAcyclic(
    activityId,
    prerequisiteActivityIds,
    existingEdges,
  );
  if (!cycle.ok) {
    throw new DomainError("INVARIANT_VIOLATION", cycle.message, cycle.code);
  }
}

async function assertSuggestedSequencesSameTrack(
  trackId: LearningActivity["trackId"],
  activityId: LearningActivityId,
  nextActivityIds: readonly LearningActivityId[],
  deps: { readonly activities: LearningActivityRepository },
): Promise<void> {
  for (const id of nextActivityIds) {
    if (id === activityId) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "An activity cannot list itself in its suggested sequence.",
        "suggested_self_loop",
      );
    }
  }
  if (nextActivityIds.length === 0) return;
  const siblings = await deps.activities.byTrack(trackId);
  const siblingIds = new Set(siblings.map((s) => s.id));
  for (const id of nextActivityIds) {
    if (!siblingIds.has(id)) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Suggested-next activity ${id} is not on the same track.`,
        "suggested_cross_track",
      );
    }
  }
}
