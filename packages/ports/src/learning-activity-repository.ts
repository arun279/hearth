import type {
  ActivityAudience,
  ActivityFlow,
  ActivityPart,
  ActivityWindow,
  CompletionRule,
  LearningActivity,
  LearningActivityDraft,
  LearningActivityId,
  LearningActivityListItem,
  LearningTrackId,
  PostClosePolicy,
} from "@hearth/domain";
import type { Write } from "./_brand.ts";

/**
 * Patch shape for `update`. Each field is independently optional so the
 * caller can patch any subset of the activity body. `window` /
 * `postClosePolicy` accept `null` as the explicit "clear" signal.
 *
 * Part ids are caller-owned: the adapter persists `patch.parts` exactly
 * as supplied, so a Part whose id matches the prior version's keeps its
 * id (and the M11 `part_progress.partId` references that pin to it
 * survive). The composer satisfies this by mounting the prior parts
 * into its draft state on edit, mutating in place, and minting fresh
 * ids only when `addPart` fires. The Zod `partIdRef` schema rejects any
 * Part whose id is missing or empty, so a caller cannot accidentally
 * publish a list that would orphan progress rows; what the caller
 * cannot do is rely on the adapter to "match by content" and re-derive
 * ids — there is no semantic-equality oracle for arbitrary Part bodies.
 *
 * Children (library refs, prereqs, suggested-sequences) live on
 * separate tables and are wholesale-replaced by their dedicated port
 * methods — the composer's atomic-save use case orchestrates the body
 * update and the three child writes in sequence so a single facilitator
 * action lands the full activity shape.
 */
export type LearningActivityPatch = {
  readonly title?: string;
  readonly description?: string | null;
  readonly parts?: readonly ActivityPart[];
  readonly flow?: ActivityFlow;
  readonly audience?: ActivityAudience;
  readonly window?: ActivityWindow | null;
  readonly postClosePolicy?: PostClosePolicy | null;
  readonly completionRule?: CompletionRule;
};

export type ActivityLibraryRefRow = {
  readonly id: string;
  readonly activityId: LearningActivityId;
  readonly libraryItemId: string;
  readonly pinnedRevisionId: string | null;
};

export interface LearningActivityRepository {
  /**
   * Mutating methods (those that touch D1) carry the `Write<>` brand so
   * the killswitch-coverage test can enumerate them at compile time. A
   * new branded method without a corresponding CASES entry in
   * `packages/adapters/cloudflare/test/killswitch-coverage.test.ts`
   * fails `tsc` with the missing label named in the error. Reads stay
   * unbranded. The brand is type-only (no runtime cost).
   */

  /**
   * Insert a new Learning Activity row + its library refs in one D1 batch.
   * `gate.assertWritable()` runs first (resilience invariant 2). Envelope
   * shapes are re-validated structurally inside the adapter as defense in
   * depth — a malformed envelope from a non-route caller still cannot
   * land. Returns the realized aggregate (including the freshly-minted id).
   */
  create: Write<
    (input: {
      readonly draft: LearningActivityDraft;
      readonly createdBy: import("@hearth/domain").UserId;
    }) => Promise<LearningActivity>
  >;

  /**
   * Aggregate read: the activity row plus its library refs, prerequisites,
   * and suggested-sequence edges. The adapter issues the three child
   * queries in parallel via `Promise.all` so the activity-detail surface
   * does not N+1 — a single LEFT JOIN composite would force JS-side
   * row-deduplication for what are intrinsically separate child sets.
   * Envelope JSON is re-parsed on read; an unknown `v` throws
   * `DomainError("INVARIANT_VIOLATION", …)`.
   */
  byId(id: LearningActivityId): Promise<LearningActivity | null>;

  /**
   * List all activities for a track, projected for the Activities tab.
   * Includes computed counts (`prereqCount`, `libraryRefCount`, …) and
   * the `partKindSequence` icon strip so the SPA renders rows without
   * decoding the full envelope per item. Hidden access states are
   * filtered out by the adapter — the route never sees a row the
   * viewer is not allowed to see.
   */
  byTrack(trackId: LearningTrackId): Promise<readonly LearningActivityListItem[]>;

  /**
   * Apply a patch with the id-preserving merge for Parts: any Part in
   * `patch.parts` whose `id` matches a Part in the prior version keeps
   * that id; new Parts are stored with caller-supplied ids that the SPA
   * mints at part-add time (so reorders during a session don't churn
   * the ids future Part Progress rows will reference). The adapter
   * re-runs cycle detection inside its D1 transaction.
   */
  update: Write<
    (input: {
      readonly id: LearningActivityId;
      readonly patch: LearningActivityPatch;
      readonly by: import("@hearth/domain").UserId;
    }) => Promise<LearningActivity>
  >;

  /**
   * Hard delete only when no `activity_records` reference the activity.
   * The adapter's transaction also checks no other activity holds this
   * one as a hard prerequisite (the cross-activity DAG guard); refusal
   * surfaces as `DomainError("CONFLICT", …)` with a code the SPA can
   * pattern-match to render the right error copy.
   */
  delete: Write<
    (input: {
      readonly id: LearningActivityId;
      readonly by: import("@hearth/domain").UserId;
    }) => Promise<void>
  >;

  /**
   * Wholesale replace of the activity's library refs. The adapter does
   * delete-then-batch-insert in one transaction; the `(activityId,
   * libraryItemId)` UNIQUE index serializes concurrent replacements.
   * Pinning a revision that does not belong to the same library item is
   * rejected with `DomainError("INVARIANT_VIOLATION", …,
   * "pinned_revision_not_in_item")`.
   */
  setLibraryRefs: Write<
    (input: {
      readonly activityId: LearningActivityId;
      readonly refs: ReadonlyArray<{
        readonly libraryItemId: string;
        readonly pinnedRevisionId: string | null;
      }>;
    }) => Promise<readonly ActivityLibraryRefRow[]>
  >;

  listLibraryRefs(activityId: LearningActivityId): Promise<readonly ActivityLibraryRefRow[]>;

  /**
   * Reverse lookup powering the "Used in N activities" affordance on the
   * Library Item detail surface — pinpoints why a Library Item's
   * hard-delete is blocked.
   */
  activitiesUsingLibraryItem(
    libraryItemId: string,
  ): Promise<readonly { readonly id: LearningActivityId; readonly title: string }[]>;

  /**
   * Wholesale replace of the activity's hard prerequisite edges across
   * activities (`activity_prerequisites`). The adapter re-runs the
   * cross-activity cycle check against the post-write graph state inside
   * its transaction; a cycle aborts with `DomainError("INVARIANT_VIOLATION",
   * …, "cross_activity_prereq_cycle")`. Self-edges are pre-rejected by
   * the use case but defensively re-rejected here.
   */
  setPrerequisites: Write<
    (input: {
      readonly activityId: LearningActivityId;
      readonly prerequisiteActivityIds: readonly LearningActivityId[];
    }) => Promise<readonly LearningActivityId[]>
  >;

  /** Wholesale replace of the activity's soft suggested-sequence edges. */
  setSuggestedSequences: Write<
    (input: {
      readonly activityId: LearningActivityId;
      readonly nextActivityIds: readonly LearningActivityId[];
    }) => Promise<readonly LearningActivityId[]>
  >;

  /**
   * "What activities does this one depend on?" — used on activity-detail
   * to list prereqs by title. Returns hard-edge sources only.
   */
  listPrerequisitesFor(activityId: LearningActivityId): Promise<readonly LearningActivityId[]>;

  /**
   * "What activities depend on this one?" — used by the delete use case
   * to refuse a delete that would orphan dependents, and by the SPA to
   * warn the facilitator before the refusal lands.
   */
  listDependentsOf(
    activityId: LearningActivityId,
  ): Promise<readonly { readonly id: LearningActivityId; readonly title: string }[]>;

  /** Activity count on a track — backs the Activities tab's badge counter. */
  countByTrack(trackId: LearningTrackId): Promise<number>;
}
