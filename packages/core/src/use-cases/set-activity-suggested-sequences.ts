import { DomainError, type LearningActivityId, type UserId } from "@hearth/domain";
import { canSetSuggestedSequences } from "@hearth/domain/policy/can-set-suggested-sequences";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadEditableActivityWithSiblings } from "./_lib/load-editable-activity-with-siblings.ts";

export type SetActivitySuggestedSequencesInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly nextActivityIds: readonly LearningActivityId[];
};

export type SetActivitySuggestedSequencesDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Replace the activity's soft suggested-sequence edges. No cycle check
 * — soft edges are non-blocking guidance and a soft cycle is tolerable.
 * Same-track invariant still applies so the SPA's selector contract
 * (next activity is on the same track) holds at the storage layer too.
 */
export async function setActivitySuggestedSequences(
  input: SetActivitySuggestedSequencesInput,
  deps: SetActivitySuggestedSequencesDeps,
): Promise<readonly LearningActivityId[]> {
  const { siblingIds } = await loadEditableActivityWithSiblings(
    input.actor,
    input.activityId,
    canSetSuggestedSequences,
    deps,
  );

  for (const id of input.nextActivityIds) {
    if (id === input.activityId) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "An activity cannot suggest itself.",
        "suggested_self_edge",
      );
    }
    if (!siblingIds.has(id)) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Suggested activity ${id} is not on the same track.`,
        "suggested_cross_track",
      );
    }
  }

  return deps.activities.setSuggestedSequences({
    activityId: input.activityId,
    nextActivityIds: input.nextActivityIds,
  });
}
