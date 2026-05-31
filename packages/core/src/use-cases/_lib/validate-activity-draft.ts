import {
  type ActivityAudience,
  assertActivityFlowAcyclic,
  assertDisplayOrderIsTopoSort,
  assertEdgePartIdsExist,
  assertNoDuplicateLibraryRefs,
  assertNoDuplicatePartIds,
  assertPartLibraryRefMimeMatch,
  assertWindowConsistent,
  DomainError,
  displayKindFor,
  type LearningActivityDraft,
  type LearningTrackId,
  type LibraryDisplayKind,
  type LibraryItemId,
  type UserId,
} from "@hearth/domain";
import { canAttachLibraryItemToActivity } from "@hearth/domain/policy/can-attach-library-item-to-activity";
import type { LearningTrackRepository, LibraryItemRepository, RegexMatcher } from "@hearth/ports";

/**
 * Run every pure invariant + every async lookup the create / update use
 * cases share before persisting an activity draft. The lookups
 * (Library Item state, current revision MIME, audience subset
 * enrollments) live here rather than in the use case bodies so a
 * future caller cannot forget one. Each failure throws a `DomainError`
 * with a stable `reason` code the route maps to RFC 7807.
 *
 * Pure invariants run first (cheap, deterministic) so the round-trip
 * lookups happen only on otherwise-well-formed drafts.
 */
export type ValidateActivityDraftDeps = {
  readonly library: LibraryItemRepository;
  readonly tracks: LearningTrackRepository;
  readonly regexMatcher: RegexMatcher;
};

export async function validateActivityDraft(
  draft: LearningActivityDraft,
  deps: ValidateActivityDraftDeps,
): Promise<void> {
  // 1. Pure invariants on the in-memory draft.
  const invariants = [
    assertNoDuplicatePartIds(draft.parts),
    assertEdgePartIdsExist(draft.flow, draft.parts),
    assertActivityFlowAcyclic(draft.flow),
    assertDisplayOrderIsTopoSort(draft.flow, draft.parts),
    assertWindowConsistent(draft.window, draft.postClosePolicy),
    assertNoDuplicateLibraryRefs(draft.libraryRefs),
  ] as const;
  for (const r of invariants) {
    if (!r.ok) {
      throw new DomainError("INVARIANT_VIOLATION", r.message, r.code);
    }
  }

  // 1b. Quiz answer keys must compile under the grading engine (RE2). A key
  // that can't compile would silently never grade — a learner's correct
  // answer would come back "ungraded" — so reject it at compose time and let
  // the facilitator fix it now. (Linear-time RE2 also makes the key
  // ReDoS-safe; there is no separate complexity gate to apply.)
  for (const part of draft.parts) {
    if (part.kind !== "quiz") continue;
    for (const question of part.questions) {
      if (question.shape.kind !== "short_answer") continue;
      const key = question.shape.answerKeyRegex;
      if (key !== undefined && !deps.regexMatcher.isValid(key)) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          `Quiz question ${question.id} has an answer key that is not a valid pattern.`,
          "quiz_answer_key_regex_invalid",
        );
      }
    }
  }

  // 2. Library Item lookups: every referenced item must exist + be in
  // the same group as the track + not retired (soft-stop). The current
  // revision's MIME projects to a display kind for the part-kind /
  // mime match invariant.
  const referencedLibraryItemIds = collectLibraryItemIds(draft);
  const displayKindByItem = new Map<string, LibraryDisplayKind>();
  if (referencedLibraryItemIds.size > 0) {
    const trackGroupId = await loadTrackGroupId(deps.tracks, draft.trackId);
    for (const id of referencedLibraryItemIds) {
      const item = await deps.library.byId(id as LibraryItemId);
      if (!item) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          `Library Item ${id} does not exist.`,
          "library_item_missing",
        );
      }
      if (item.groupId !== trackGroupId) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          `Library Item ${id} belongs to another group.`,
          "library_item_wrong_group",
        );
      }
      const attach = canAttachLibraryItemToActivity(item);
      if (!attach.ok) {
        throw new DomainError("FORBIDDEN", attach.reason.message, attach.reason.code);
      }
      const revision = await deps.library.currentRevision(item.id);
      if (!revision) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          `Library Item ${id} has no current revision.`,
          "library_item_no_revision",
        );
      }
      displayKindByItem.set(item.id, displayKindFor(revision.mimeType));
    }
  }
  const mimeMatch = assertPartLibraryRefMimeMatch(draft.parts, displayKindByItem);
  if (!mimeMatch.ok) {
    throw new DomainError("INVARIANT_VIOLATION", mimeMatch.message, mimeMatch.code);
  }

  // 3. `pinnedRevisionId`s carried on `libraryRefs` must belong to the
  // same library item — mismatches cannot land. The check is best-effort
  // here; the adapter re-asserts via FK + an inner-transaction read.
  for (const ref of draft.libraryRefs) {
    if (!ref.pinnedRevisionId) continue;
    const revisions = await deps.library.listRevisions(ref.libraryItemId as LibraryItemId);
    const ok = revisions.some((r) => r.id === ref.pinnedRevisionId);
    if (!ok) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Pinned revision ${ref.pinnedRevisionId} does not belong to library item ${ref.libraryItemId}.`,
        "pinned_revision_not_in_item",
      );
    }
  }

  // 4. Audience subset must match current track enrollment. Departed
  // users are filtered downstream at read time (M11 / M12), but we
  // refuse to PERSIST an audience containing a userId who isn't a
  // current enrollee — the SPA's roster picker only surfaces current
  // enrollments anyway.
  await assertAudienceUsersAreEnrolled(draft.audience, draft.trackId, deps.tracks);
}

function collectLibraryItemIds(draft: LearningActivityDraft): Set<string> {
  const ids = new Set<string>();
  for (const p of draft.parts) {
    if ("libraryItemId" in p && typeof p.libraryItemId === "string") {
      ids.add(p.libraryItemId);
    }
  }
  for (const r of draft.libraryRefs) {
    ids.add(r.libraryItemId);
  }
  return ids;
}

async function loadTrackGroupId(tracks: LearningTrackRepository, trackId: LearningTrackId) {
  const t = await tracks.byId(trackId);
  if (!t) {
    throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
  }
  return t.groupId;
}

async function assertAudienceUsersAreEnrolled(
  audience: ActivityAudience,
  trackId: LearningTrackId,
  tracks: LearningTrackRepository,
): Promise<void> {
  if (audience.kind !== "subset") return;
  if (audience.userIds.length === 0) return;
  const enrollments = await tracks.listEnrollments(trackId, { includeLeft: false });
  const enrolledIds = new Set<UserId>(enrollments.map((e) => e.userId));
  for (const id of audience.userIds) {
    if (!enrolledIds.has(id)) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Audience userId ${id} is not a current enrollee on this track.`,
        "audience_user_not_enrolled",
      );
    }
  }
}
