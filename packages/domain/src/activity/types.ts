import type { LearningActivityId, LearningTrackId, UserId } from "../ids.ts";
import type { ActivityPart } from "../parts/index.ts";

/**
 * One Prerequisite or Suggested-Sequence edge between two Parts of the
 * same Activity. `hard` edges block — the toPart is not accessible until
 * the fromPart is complete. `soft` edges are ordering hints surfaced in
 * the UI but never gating completion.
 */
export type ActivityFlowEdge = {
  readonly fromPartId: string;
  readonly toPartId: string;
  readonly kind: "hard" | "soft";
};

/**
 * `displayOrder` is an optional canonical sort over Part ids that must
 * topologically respect every `kind: "hard"` edge. When absent, the SPA
 * derives one client-side; when present, the save invariant is enforced
 * server-side so persisted JSON is never internally inconsistent.
 */
export type ActivityFlow = {
  readonly prereqs: readonly ActivityFlowEdge[];
  readonly displayOrder?: readonly string[];
};

export type ActivityAudience =
  | { readonly kind: "everyone_enrolled" }
  | { readonly kind: "subset"; readonly userIds: readonly UserId[] };

/**
 * Every timestamp is unix epoch ms. Independent nullability — a window
 * with `opensAt` set but no `dueAt` or `closesAt` is valid (means "open
 * from this moment, no deadline, no close"). The whole `windowJson`
 * column is nullable at the row level, expressing "no window at all"
 * versus "an empty/all-null window."
 */
export type ActivityWindow = {
  readonly opensAt: number | null;
  readonly dueAt: number | null;
  readonly closesAt: number | null;
};

export type PostClosePolicy =
  | { readonly kind: "hidden" }
  | { readonly kind: "visible_locked" }
  | { readonly kind: "visible_completable" };

/**
 * v1 ships `manual_mark` and `all_parts_complete`. Signal-driven variants
 * (`quiz_passed`, `session_attended`) are deferred — the Evidence Signals
 * table already collects the data needed to add them via additive
 * variants without breaking stored rows.
 */
export type CompletionRule =
  | { readonly kind: "manual_mark" }
  | { readonly kind: "all_parts_complete" };

export type ActivityLibraryRef = {
  readonly id: string;
  readonly activityId: LearningActivityId;
  readonly libraryItemId: string;
  readonly pinnedRevisionId: string | null;
};

export type LearningActivity = {
  readonly id: LearningActivityId;
  readonly trackId: LearningTrackId;
  readonly title: string;
  readonly description: string | null;
  readonly parts: readonly ActivityPart[];
  readonly flow: ActivityFlow;
  readonly audience: ActivityAudience;
  readonly window: ActivityWindow | null;
  readonly postClosePolicy: PostClosePolicy | null;
  readonly completionRule: CompletionRule;
  readonly participationMode: "individual";
  readonly libraryRefs: readonly ActivityLibraryRef[];
  readonly prerequisiteActivityIds: readonly LearningActivityId[];
  readonly suggestedNextActivityIds: readonly LearningActivityId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/**
 * The shape passed into the `create-activity` use case. Library refs and
 * cross-activity edges are split into their own arrays so the use case +
 * adapter can write them atomically into the dedicated tables. Part ids
 * are caller-supplied — the SPA mints a URL-safe id at the moment a
 * Part is added so reorders within an authoring session don't churn
 * ids. Part Progress rows in M11 reference these ids; if the composer
 * regenerated ids on every save, every reorder would orphan progress.
 */
export type LearningActivityDraft = {
  readonly trackId: LearningTrackId;
  readonly title: string;
  readonly description: string | null;
  readonly parts: readonly ActivityPart[];
  readonly flow: ActivityFlow;
  readonly audience: ActivityAudience;
  readonly window: ActivityWindow | null;
  readonly postClosePolicy: PostClosePolicy | null;
  readonly completionRule: CompletionRule;
  readonly libraryRefs: ReadonlyArray<{
    readonly libraryItemId: string;
    readonly pinnedRevisionId: string | null;
  }>;
  readonly prerequisiteActivityIds: readonly LearningActivityId[];
  readonly suggestedNextActivityIds: readonly LearningActivityId[];
};

/**
 * The activity's accessibility for a viewer at the moment of read.
 * `pre_open` and `locked` are window-driven and ship in M9; `hidden`
 * surfaces today for the post-close `hidden` policy and routes 404 in
 * the API layer. M11 will grow the union further when Activity Records
 * make prerequisite-driven locking observable per-viewer. Any UI state
 * that depends on "is this completable?" reads from here.
 */
export type ActivityAccessState = "open" | "pre_open" | "locked" | "hidden";

/**
 * Row projection for the Activities tab. Shared by the port, adapter,
 * and SPA so the wire shape doesn't drift across layers. Includes the
 * computed counts the SPA needs to render `<ActivityRow>` (prereq
 * count, library-ref count, suggested-next count, part-kind icon
 * strip) without an N+1 fetch per row.
 */
export type LearningActivityListItem = {
  readonly id: LearningActivityId;
  readonly trackId: LearningTrackId;
  readonly title: string;
  readonly description: string | null;
  readonly partCount: number;
  readonly partKindSequence: readonly string[];
  readonly libraryRefCount: number;
  readonly prereqCount: number;
  readonly suggestedNextCount: number;
  readonly audienceKind: ActivityAudience["kind"];
  readonly window: ActivityWindow | null;
  readonly postClosePolicy: PostClosePolicy | null;
  readonly completionRuleKind: CompletionRule["kind"];
  readonly accessState: ActivityAccessState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
