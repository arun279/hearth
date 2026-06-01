import {
  type ActivityPart,
  type ActivityPlayerProjection,
  computeActivityAccessState,
  DomainError,
  type LearningActivity,
  type LearningActivityId,
  type LibraryItemId,
  type LibraryRevision,
  type LibraryRevisionId,
  type ResolvedLibraryRef,
  redactQuizAnswerKeys,
  type UserId,
  type ViewerEnrollmentStatus,
} from "@hearth/domain";
import { canSeeActivity } from "@hearth/domain/policy";
import type {
  Clock,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  LibraryItemRepository,
  ObjectStorage,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";

/**
 * The Activity Player's signed-GET TTL. One hour matches the cadence of
 * a "typical viewing session" — long enough for a participant to keep a
 * `<video>` / `<audio>` element backed by one URL, short enough that a
 * screenshot of the URL stops working before it can be shared. On the
 * 403 path the SPA refetches `/player` and re-mounts the affected Part.
 */
const READ_URL_TTL_SECONDS = 3600;

export type GetActivityForPlayerInput = {
  readonly actor: UserId;
  readonly id: LearningActivityId;
};

export type GetActivityForPlayerDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly library: LibraryItemRepository;
  readonly storage: ObjectStorage;
  readonly clock: Clock;
};

/**
 * Compose the projection the Activity Player route returns. One use
 * case, three concerns, in order:
 *
 *   1. Load the activity through `loadViewableActivity` — gives the
 *      caller-context bundle (actor, group, track, membership,
 *      enrollment) and 404s on a non-viewer per the existence-leak rule.
 *   2. Re-run the audience-aware `canSeeActivity` policy on top of that
 *      (the wrapper only enforces track viewability). A subset-audience
 *      participant not listed for THIS activity gets the same 404 a
 *      stranger does.
 *   3. Compute `accessState` against the injected clock. `hidden` (post-
 *      close hidden policy) collapses to the same 404; `pre_open` and
 *      `locked` surface to the SPA so the player chrome can render the
 *      banner without a second fetch.
 *
 * Library refs resolve to signed GET URLs only when the activity is
 * actually accessible — `pre_open` activities skip URL signing entirely
 * so the R2 GET budget is preserved when a participant is just peeking
 * at the chrome.
 *
 * Per-Part progress + per-Part status are deliberately not in this
 * projection. The SPA sources per-Part completion from the sibling
 * `GET /my-record` query (the participant's own `activity_records` row),
 * keeping this player-chrome read free of the per-viewer record fetch.
 */
export async function getActivityForPlayer(
  input: GetActivityForPlayerInput,
  deps: GetActivityForPlayerDeps,
): Promise<ActivityPlayerProjection> {
  const ctx = await loadViewableActivity(input.actor, input.id, deps);
  const operator = await deps.policy.getOperator(input.actor);

  const access = canSeeActivity(
    ctx.actor,
    ctx.group,
    ctx.track,
    ctx.activity.audience,
    ctx.groupMembership,
    ctx.trackEnrollment,
    operator,
  );
  if (!access.ok) {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }

  const now = deps.clock.now();
  const accessState = computeActivityAccessState(
    ctx.activity.window,
    ctx.activity.postClosePolicy,
    now,
  );
  if (accessState === "hidden") {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }

  const resolvedRefs =
    accessState === "pre_open" ? [] : await resolveLibraryRefs(ctx.activity, deps, now);

  return {
    // Quiz answer keys never cross the wire to a learner — strip them from
    // every quiz Part so the auto-score can't be read off the network tab.
    // Grading runs server-side against the unredacted `partsJson`.
    activity: {
      ...ctx.activity,
      parts: ctx.activity.parts.map((p) => (p.kind === "quiz" ? redactQuizAnswerKeys(p) : p)),
    },
    resolvedRefs,
    accessState,
    viewer: { enrollmentStatus: enrollmentStatusOf(ctx.trackEnrollment) },
  };
}

function enrollmentStatusOf(
  enrollment: { readonly role: "facilitator" | "participant"; readonly leftAt: Date | null } | null,
): ViewerEnrollmentStatus {
  if (enrollment === null || enrollment.leftAt !== null) return "not_enrolled";
  return enrollment.role;
}

/**
 * Map every library-referencing Part to its resolved revision + signed
 * read URL. Revisions are coalesced by `(libraryItemId, pinnedRevisionId)`
 * — two Parts pointing at the same library item share one signed URL
 * round-trip. Three steps in parallel:
 *
 *   1. For unpinned refs, look up `currentRevision(libraryItemId)`.
 *   2. For pinned refs, look up `revisionById(pinnedRevisionId)`.
 *   3. For every distinct (resolved) revision, mint a signed URL.
 *
 * The signing call is the largest variable cost — at v1 scale this is
 * typically 1–3 calls per player open, well inside the free-tier R2
 * Class B budget. The composer enforces `assertPartLibraryRefMimeMatch`
 * at save time, so any mismatch here means the data drifted under us;
 * we surface that as `INVARIANT_VIOLATION` rather than silently rendering
 * a broken Part.
 */
async function resolveLibraryRefs(
  activity: LearningActivity,
  deps: GetActivityForPlayerDeps,
  now: Date,
): Promise<readonly ResolvedLibraryRef[]> {
  const refByItem = new Map<string, { pinnedRevisionId: LibraryRevisionId | null }>();
  for (const ref of activity.libraryRefs) {
    refByItem.set(ref.libraryItemId, {
      pinnedRevisionId: ref.pinnedRevisionId as LibraryRevisionId | null,
    });
  }

  const partsByLibraryItem = new Map<string, readonly { partId: string }[]>();
  for (const part of activity.parts) {
    const itemId = libraryItemIdOfPart(part);
    if (!itemId) continue;
    const list = partsByLibraryItem.get(itemId) ?? [];
    partsByLibraryItem.set(itemId, [...list, { partId: part.id }]);
  }

  const resolvedByItem = new Map<string, { revision: LibraryRevision; isPinned: boolean }>();

  const resolutions = await Promise.all(
    [...partsByLibraryItem.keys()].map(async (itemId) => {
      const ref = refByItem.get(itemId);
      if (!ref) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          `Part references library item ${itemId} but the activity has no matching library ref.`,
          "library_ref_not_attached",
        );
      }
      if (ref.pinnedRevisionId !== null) {
        const revision = await deps.library.revisionById(ref.pinnedRevisionId);
        if (!revision) {
          throw new DomainError(
            "INVARIANT_VIOLATION",
            `Pinned revision ${ref.pinnedRevisionId} not found for library item ${itemId}.`,
            "pinned_revision_not_in_item",
          );
        }
        return { itemId, revision, isPinned: true } as const;
      }
      const current = await deps.library.currentRevision(itemId as LibraryItemId);
      if (!current) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          `Library item ${itemId} has no current revision.`,
          "library_item_no_revision",
        );
      }
      return { itemId, revision: current, isPinned: false } as const;
    }),
  );

  for (const r of resolutions) {
    resolvedByItem.set(r.itemId, { revision: r.revision, isPinned: r.isPinned });
  }

  const signedByRevision = new Map<LibraryRevisionId, string>();
  const distinctRevisions = new Map<LibraryRevisionId, LibraryRevision>();
  for (const v of resolvedByItem.values()) {
    distinctRevisions.set(v.revision.id, v.revision);
  }
  const signed = await Promise.all(
    [...distinctRevisions.values()].map(async (rev) => ({
      id: rev.id,
      url: await deps.storage.getDownloadUrl({
        key: rev.storageKey,
        ttlSeconds: READ_URL_TTL_SECONDS,
      }),
    })),
  );
  for (const s of signed) signedByRevision.set(s.id, s.url);

  const expiresAt = new Date(now.getTime() + READ_URL_TTL_SECONDS * 1000);
  const out: ResolvedLibraryRef[] = [];
  for (const part of activity.parts) {
    const itemId = libraryItemIdOfPart(part);
    if (!itemId) continue;
    const resolved = resolvedByItem.get(itemId);
    if (!resolved) continue;
    const url = signedByRevision.get(resolved.revision.id);
    if (!url) continue;
    out.push({
      partId: part.id,
      libraryItemId: itemId as LibraryItemId,
      revisionId: resolved.revision.id,
      isPinned: resolved.isPinned,
      mimeType: resolved.revision.mimeType,
      readUrl: url,
      readUrlExpiresAt: expiresAt,
    });
  }
  return out;
}

/**
 * Narrow a Part to its (optional) library item id without an unsafe
 * cast: the type predicate on the discriminator pulls the libraryItemId
 * out of the three Part kinds that carry one, and returns `null` for
 * embed / reflection / quiz / attend_session.
 */
function libraryItemIdOfPart(part: ActivityPart): string | null {
  if (
    part.kind === "read_library_item" ||
    part.kind === "listen_audio" ||
    part.kind === "watch_video"
  ) {
    return part.libraryItemId;
  }
  return null;
}
