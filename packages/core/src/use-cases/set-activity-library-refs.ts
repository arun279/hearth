import {
  assertNoDuplicateLibraryRefs,
  assertPartLibraryRefMimeMatch,
  DomainError,
  displayKindFor,
  type LearningActivityId,
  type LibraryDisplayKind,
  type LibraryItemId,
  type UserId,
} from "@hearth/domain";
import { canAttachLibraryItemToActivity } from "@hearth/domain/policy/can-attach-library-item-to-activity";
import { canEditLearningActivity } from "@hearth/domain/policy/can-edit-learning-activity";
import type {
  ActivityLibraryRefRow,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

export type SetActivityLibraryRefsInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly refs: ReadonlyArray<{
    readonly libraryItemId: string;
    readonly pinnedRevisionId: string | null;
  }>;
};

export type SetActivityLibraryRefsDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
  readonly activities: LearningActivityRepository;
};

/**
 * Wholesale-replace the library refs attached to an activity. Refused
 * for retired items (soft-stop). Pinned revisions must belong to the
 * named library item — the route surfaces the deny code so the SPA can
 * render a precise error message.
 */
export async function setActivityLibraryRefs(
  input: SetActivityLibraryRefsInput,
  deps: SetActivityLibraryRefsDeps,
): Promise<readonly ActivityLibraryRefRow[]> {
  const { actor, group, track, groupMembership, trackEnrollment, activity } =
    await loadViewableActivity(input.actor, input.activityId, deps);

  const verdict = canEditLearningActivity(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const dup = assertNoDuplicateLibraryRefs(input.refs);
  if (!dup.ok) {
    throw new DomainError("INVARIANT_VIOLATION", dup.message, dup.code);
  }

  // Walk the input refs once: confirm existence, same-group, optional
  // retired-soft-stop, optional pinned-revision integrity, and project
  // the current revision's mime to a display kind for the mime-match
  // check below.
  const displayKindByItem = new Map<string, LibraryDisplayKind>();
  for (const ref of input.refs) {
    const item = await deps.library.byId(ref.libraryItemId as LibraryItemId);
    if (!item) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Library Item ${ref.libraryItemId} does not exist.`,
        "library_item_missing",
      );
    }
    if (item.groupId !== group.id) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Library Item ${ref.libraryItemId} belongs to another group.`,
        "library_item_wrong_group",
      );
    }
    // The "is this item attachable to a NEW activity" check fires for
    // refs that aren't already on the activity. Existing refs on a
    // newly-retired item keep working — the soft-stop is forward-only.
    const alreadyAttached = activity.libraryRefs.some((r) => r.libraryItemId === ref.libraryItemId);
    if (!alreadyAttached) {
      const attach = canAttachLibraryItemToActivity(item);
      if (!attach.ok) {
        throw new DomainError("FORBIDDEN", attach.reason.message, attach.reason.code);
      }
    }
    const revision = await deps.library.currentRevision(item.id);
    if (!revision) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Library Item ${ref.libraryItemId} has no current revision.`,
        "library_item_no_revision",
      );
    }
    if (ref.pinnedRevisionId) {
      const revisions = await deps.library.listRevisions(item.id);
      const ok = revisions.some((r) => r.id === ref.pinnedRevisionId);
      if (!ok) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          `Pinned revision ${ref.pinnedRevisionId} does not belong to library item ${ref.libraryItemId}.`,
          "pinned_revision_not_in_item",
        );
      }
    }
    displayKindByItem.set(item.id, displayKindFor(revision.mimeType));
  }

  // Mime-match: every Part on the activity that points at a library
  // item must match the kind it's pointing at. Setting refs without
  // re-asserting this would let a facilitator swap a `read_library_item`
  // Part's audio backing in by replacing the activity's refs with a
  // newly-typed item. The check runs against the activity's *existing*
  // parts (refs may include items that aren't part-attached too —
  // those carry no kind constraint and pass through silently).
  const mimeMatch = assertPartLibraryRefMimeMatch(activity.parts, displayKindByItem);
  if (!mimeMatch.ok) {
    throw new DomainError("INVARIANT_VIOLATION", mimeMatch.message, mimeMatch.code);
  }

  return deps.activities.setLibraryRefs({
    activityId: input.activityId,
    refs: input.refs,
  });
}
