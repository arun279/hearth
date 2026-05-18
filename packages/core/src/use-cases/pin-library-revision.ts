import {
  DomainError,
  type LearningActivityId,
  type LibraryItemId,
  type UserId,
} from "@hearth/domain";
import type {
  ActivityLibraryRefRow,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadAttachedLibraryRef } from "./_lib/load-attached-library-ref.ts";

export type PinLibraryRevisionInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly libraryItemId: string;
  readonly revisionId: string;
};

export type PinLibraryRevisionDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Pin a specific Library Revision on an existing library ref. Refuses
 * with `pinned_revision_not_in_item` when the revision belongs to a
 * different library item; refuses `library_ref_not_attached` if the
 * activity does not currently reference the named item.
 */
export async function pinLibraryRevision(
  input: PinLibraryRevisionInput,
  deps: PinLibraryRevisionDeps,
): Promise<readonly ActivityLibraryRefRow[]> {
  const activity = await loadAttachedLibraryRef(
    input.actor,
    input.activityId,
    input.libraryItemId,
    deps,
  );

  const revisions = await deps.library.listRevisions(input.libraryItemId as LibraryItemId);
  if (!revisions.some((r) => r.id === input.revisionId)) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Pinned revision ${input.revisionId} does not belong to library item ${input.libraryItemId}.`,
      "pinned_revision_not_in_item",
    );
  }

  const nextRefs = activity.libraryRefs.map((r) => ({
    libraryItemId: r.libraryItemId,
    pinnedRevisionId:
      r.libraryItemId === input.libraryItemId ? input.revisionId : r.pinnedRevisionId,
  }));
  return deps.activities.setLibraryRefs({
    activityId: input.activityId,
    refs: nextRefs,
  });
}
