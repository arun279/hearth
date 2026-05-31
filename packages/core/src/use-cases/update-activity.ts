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
  RegexMatcher,
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
  readonly regexMatcher: RegexMatcher;
};

/**
 * Atomic-save for the activity composer. The merged draft re-runs every
 * invariant via `validateActivityDraft`, so a "title only" or "audience
 * only" patch still gets full-shape validation against the activity's
 * current state. Cross-activity prereq cycles are pre-checked here; the
 * adapter re-runs the same check inside its transaction (defense in
 * depth — concurrent edits cannot slip through the gap).
 *
 * Persistence is sequenced: body row first, then library refs, prereqs,
 * suggested-sequences. Each port call is atomic. A mid-sequence failure
 * leaves the body updated but children stale; the user retries and the
 * idempotent wholesale-replace converges.
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

  const hasBodyPatch =
    input.patch.title !== undefined ||
    input.patch.description !== undefined ||
    input.patch.parts !== undefined ||
    input.patch.flow !== undefined ||
    input.patch.audience !== undefined ||
    input.patch.window !== undefined ||
    input.patch.postClosePolicy !== undefined ||
    input.patch.completionRule !== undefined;

  let updated: LearningActivity | null = null;
  if (hasBodyPatch) {
    updated = await deps.activities.update({
      id: input.id,
      patch: {
        title: merged.title,
        description: merged.description,
        parts: merged.parts,
        flow: merged.flow,
        audience: merged.audience,
        window: merged.window,
        postClosePolicy: merged.postClosePolicy,
        completionRule: merged.completionRule,
      },
      by: input.actor,
    });
  }

  let touchedChildren = false;
  if (input.patch.libraryRefs !== undefined) {
    await deps.activities.setLibraryRefs({
      activityId: input.id,
      refs: input.patch.libraryRefs,
    });
    touchedChildren = true;
  }
  if (input.patch.prerequisiteActivityIds !== undefined) {
    await deps.activities.setPrerequisites({
      activityId: input.id,
      prerequisiteActivityIds: input.patch.prerequisiteActivityIds,
    });
    touchedChildren = true;
  }
  if (input.patch.suggestedNextActivityIds !== undefined) {
    await deps.activities.setSuggestedSequences({
      activityId: input.id,
      nextActivityIds: input.patch.suggestedNextActivityIds,
    });
    touchedChildren = true;
  }

  // The body update returns the freshly-read aggregate; if no children
  // changed we hand it back directly. Children writes mutate other
  // tables (refs / prereqs / suggested) without re-reading the parent,
  // so a final composite read assembles the post-write shape.
  if (!touchedChildren && updated) {
    return updated;
  }
  const final = await deps.activities.byId(input.id);
  if (!final) {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }
  return final;
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
