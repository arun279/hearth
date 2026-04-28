import type {
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
  LibraryStewardship,
  StudyGroupId,
  UserId,
} from "@hearth/domain";

/**
 * One row in the group-scoped library list. Includes the cheap
 * indexed counts the SPA needs to render `<LibraryItemCard>`:
 * `currentRevision` for the kind/size badge and `usedInCount` for
 * "used in N activities" — both denormalized at the query layer so
 * the SPA never needs an N+1 hop.
 */
export type LibraryItemListEntry = {
  readonly item: LibraryItem;
  readonly currentRevision: LibraryRevision | null;
  readonly stewardCount: number;
  readonly usedInCount: number;
};

export type LibraryItemDetail = {
  readonly item: LibraryItem;
  readonly revisions: readonly LibraryRevision[];
  readonly stewards: readonly LibraryStewardship[];
  readonly usedInCount: number;
};

export type CreateLibraryItemInput = {
  readonly id: LibraryItemId;
  readonly groupId: StudyGroupId;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly uploadedBy: UserId;
  readonly firstRevision: CreateLibraryRevisionInput;
  readonly now: Date;
};

export type CreateLibraryRevisionInput = {
  readonly id: LibraryRevisionId;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly originalFilename: string | null;
  readonly uploadedBy: UserId;
  readonly uploadedAt: Date;
};

export type UpdateLibraryMetadataInput = {
  readonly title?: string;
  readonly description?: string | null;
  readonly tags?: readonly string[];
};

export type AddLibraryRevisionInput = {
  readonly libraryItemId: LibraryItemId;
  readonly revision: CreateLibraryRevisionInput;
};

export type AddLibraryStewardInput = {
  readonly libraryItemId: LibraryItemId;
  readonly userId: UserId;
  readonly grantedBy: UserId;
  readonly grantedAt: Date;
};

export type RemoveLibraryStewardInput = {
  readonly libraryItemId: LibraryItemId;
  readonly userId: UserId;
};

/**
 * Drives the Library aggregate from the use-case layer. The adapter is
 * the *only* place that touches D1 + R2; every mutation calls
 * `gate.assertWritable()` first (resilience invariants 2 + 3 — see the
 * killswitch-coverage CI test).
 *
 * `search` is declared here so the M7 search route can compose against
 * the same port; the M6 adapter implements it as a `byGroup`-style
 * fallback that ignores the query string until M7 wires FTS5.
 */
export interface LibraryItemRepository {
  // ── Items ─────────────────────────────────────────────────────────
  /**
   * Materialize a brand-new Library Item AND its first revision in one
   * D1 batch (single SQLite transaction). The orphan invariant — every
   * item has at least one revision — is satisfied at row 0.
   */
  create(input: CreateLibraryItemInput): Promise<LibraryItemDetail>;

  byId(id: LibraryItemId): Promise<LibraryItem | null>;

  detail(id: LibraryItemId): Promise<LibraryItemDetail | null>;

  byGroup(groupId: StudyGroupId): Promise<readonly LibraryItemListEntry[]>;

  updateMetadata(id: LibraryItemId, patch: UpdateLibraryMetadataInput): Promise<LibraryItem>;

  /**
   * Set `retired_at` / `retired_by`. Idempotent: re-retiring already-
   * retired items returns the existing row.
   */
  markRetired(id: LibraryItemId, by: UserId, at: Date): Promise<LibraryItem>;

  // ── Revisions ─────────────────────────────────────────────────────
  /**
   * Append a revision to an existing item, inside one D1 batch:
   *   1) compute next revisionNumber via UNIQUE-index race guard
   *   2) insert the revision row
   *   3) bump library_items.currentRevisionId + updatedAt
   * Returns the created revision and the updated item snapshot.
   */
  addRevision(
    input: AddLibraryRevisionInput,
  ): Promise<{ revision: LibraryRevision; item: LibraryItem }>;

  listRevisions(itemId: LibraryItemId): Promise<readonly LibraryRevision[]>;

  currentRevision(itemId: LibraryItemId): Promise<LibraryRevision | null>;

  revisionById(revisionId: LibraryRevisionId): Promise<LibraryRevision | null>;

  // ── Stewards ──────────────────────────────────────────────────────
  addSteward(input: AddLibraryStewardInput): Promise<LibraryStewardship>;

  removeSteward(input: RemoveLibraryStewardInput): Promise<void>;

  listStewards(itemId: LibraryItemId): Promise<readonly LibraryStewardship[]>;

  /**
   * Helper — true iff a `library_stewards` row exists for (item, user).
   * The implicit-uploader-is-steward semantic lives in the policy layer,
   * not here; this only answers "is there a row".
   */
  isSteward(itemId: LibraryItemId, userId: UserId): Promise<boolean>;

  // ── Cross-aggregate counts ─────────────────────────────────────────
  /**
   * Count of `activity_library_refs` rows pointing at this item — the
   * "used in N activities" badge on the SPA's library card. Read-only
   * across the activity tables; M8 keeps the index up to date.
   */
  usedInCount(itemId: LibraryItemId): Promise<number>;
}
