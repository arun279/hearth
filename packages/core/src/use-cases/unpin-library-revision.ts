import type { LearningActivityId, UserId } from "@hearth/domain";
import type {
  ActivityLibraryRefRow,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadAttachedLibraryRef } from "./_lib/load-attached-library-ref.ts";

export type UnpinLibraryRevisionInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly libraryItemId: string;
};

export type UnpinLibraryRevisionDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Drop the pinned revision from a library ref so the activity follows
 * the item's `currentRevisionId`. Idempotent: an already-unpinned ref
 * resolves as a no-op success. Mirror of `pinLibraryRevision`; the load
 * + authority + attachment check is shared via `loadAttachedLibraryRef`.
 */
export async function unpinLibraryRevision(
  input: UnpinLibraryRevisionInput,
  deps: UnpinLibraryRevisionDeps,
): Promise<readonly ActivityLibraryRefRow[]> {
  const activity = await loadAttachedLibraryRef(
    input.actor,
    input.activityId,
    input.libraryItemId,
    deps,
  );

  const nextRefs = activity.libraryRefs.map((r) => ({
    libraryItemId: r.libraryItemId,
    pinnedRevisionId: r.libraryItemId === input.libraryItemId ? null : r.pinnedRevisionId,
  }));
  return deps.activities.setLibraryRefs({
    activityId: input.activityId,
    refs: nextRefs,
  });
}
