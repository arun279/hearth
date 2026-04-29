import {
  activityLibraryRefs,
  groups,
  libraryItems,
  libraryRevisions,
  libraryStewards,
} from "@hearth/db/schema";
import {
  DomainError,
  type LibraryItem,
  type LibraryItemId,
  type LibraryRevision,
  type LibraryRevisionId,
  type LibraryStewardship,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import type {
  AddLibraryRevisionInput,
  AddLibraryStewardInput,
  LibraryItemDetail,
  LibraryItemListEntry,
  LibraryItemRepository,
  LibrarySearchOptions,
  LibrarySearchPage,
  RemoveLibraryStewardInput,
} from "@hearth/ports";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { createIdGenerator } from "./id-generator.ts";

function parseTags(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function toItem(r: typeof libraryItems.$inferSelect): LibraryItem {
  return {
    id: r.id as LibraryItemId,
    groupId: r.groupId as StudyGroupId,
    title: r.title,
    description: r.description,
    tags: parseTags(r.tagsJson),
    currentRevisionId:
      r.currentRevisionId === null ? null : (r.currentRevisionId as LibraryRevisionId),
    uploadedBy: r.uploadedBy as UserId,
    retiredAt: r.retiredAt,
    retiredBy: r.retiredBy === null ? null : (r.retiredBy as UserId),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toRevision(r: typeof libraryRevisions.$inferSelect): LibraryRevision {
  return {
    id: r.id as LibraryRevisionId,
    libraryItemId: r.libraryItemId as LibraryItemId,
    revisionNumber: r.revisionNumber,
    storageKey: r.storageKey,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    originalFilename: r.originalFilename,
    uploadedBy: r.uploadedBy as UserId,
    uploadedAt: r.uploadedAt,
  };
}

function toStewardship(r: typeof libraryStewards.$inferSelect): LibraryStewardship {
  return {
    id: r.id,
    libraryItemId: r.libraryItemId as LibraryItemId,
    userId: r.userId as UserId,
    grantedAt: r.grantedAt,
    grantedBy: r.grantedBy as UserId,
  };
}

/**
 * Real D1 implementation of `LibraryItemRepository`.
 *
 * Atomicity guarantees:
 * - `create` inserts the item row + first revision row in one D1 batch
 *   (single SQLite transaction). The item row's `currentRevisionId`
 *   already points at the revision id so there is no observable window
 *   in which an item exists without a current revision.
 * - `addRevision` performs SELECT-MAX inside one round-trip and then a
 *   batched INSERT + UPDATE. The UNIQUE
 *   `(library_item_id, revision_number)` index is the authoritative race
 *   guard: a concurrent finalize that picks the same number trips the
 *   index and the insert throws. The use case maps that to 409 and the
 *   client retries.
 * - Mutation methods call `gate.assertWritable()` first (resilience
 *   invariants 2 + 3 — enforced by killswitch-coverage.test.ts).
 */
export function createLibraryItemRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): LibraryItemRepository {
  const ids = createIdGenerator();

  return {
    async create({ id, groupId, title, description, tags, uploadedBy, firstRevision, now }) {
      await deps.gate.assertWritable();
      const tagsJson = JSON.stringify(tags);
      await deps.db.batch([
        deps.db.insert(libraryItems).values({
          id,
          groupId,
          title,
          description,
          tagsJson,
          currentRevisionId: firstRevision.id,
          uploadedBy,
          retiredAt: null,
          retiredBy: null,
          createdAt: now,
          updatedAt: now,
        }),
        deps.db.insert(libraryRevisions).values({
          id: firstRevision.id,
          libraryItemId: id,
          revisionNumber: 1,
          storageKey: firstRevision.storageKey,
          mimeType: firstRevision.mimeType,
          sizeBytes: firstRevision.sizeBytes,
          originalFilename: firstRevision.originalFilename,
          uploadedBy: firstRevision.uploadedBy,
          uploadedAt: firstRevision.uploadedAt,
        }),
      ]);

      const item: LibraryItem = {
        id,
        groupId,
        title,
        description,
        tags: [...tags],
        currentRevisionId: firstRevision.id,
        uploadedBy,
        retiredAt: null,
        retiredBy: null,
        createdAt: now,
        updatedAt: now,
      };
      const revision: LibraryRevision = {
        id: firstRevision.id,
        libraryItemId: id,
        revisionNumber: 1,
        storageKey: firstRevision.storageKey,
        mimeType: firstRevision.mimeType,
        sizeBytes: firstRevision.sizeBytes,
        originalFilename: firstRevision.originalFilename,
        uploadedBy: firstRevision.uploadedBy,
        uploadedAt: firstRevision.uploadedAt,
      };
      return { item, revisions: [revision], stewards: [], usedInCount: 0 };
    },

    async byId(id) {
      const rows = await deps.db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .limit(1);
      return rows[0] ? toItem(rows[0]) : null;
    },

    async detail(id) {
      const itemRows = await deps.db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .limit(1);
      const itemRow = itemRows[0];
      if (!itemRow) return null;

      const [revisionRows, stewardRows, usedInRows] = await Promise.all([
        deps.db
          .select()
          .from(libraryRevisions)
          .where(eq(libraryRevisions.libraryItemId, id))
          .orderBy(desc(libraryRevisions.revisionNumber)),
        deps.db
          .select()
          .from(libraryStewards)
          .where(eq(libraryStewards.libraryItemId, id))
          .orderBy(asc(libraryStewards.grantedAt)),
        deps.db
          .select({ n: sql<number>`count(*)` })
          .from(activityLibraryRefs)
          .where(eq(activityLibraryRefs.libraryItemId, id)),
      ]);

      return {
        item: toItem(itemRow),
        revisions: revisionRows.map(toRevision),
        stewards: stewardRows.map(toStewardship),
        usedInCount: Number(usedInRows[0]?.n ?? 0),
      } satisfies LibraryItemDetail;
    },

    async byGroup(groupId): Promise<readonly LibraryItemListEntry[]> {
      const rows = await deps.db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.groupId, groupId))
        .orderBy(desc(libraryItems.updatedAt));
      return enrichListEntries(deps, rows);
    },

    async updateMetadata(id, patch) {
      await deps.gate.assertWritable();
      const existing = await deps.db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .limit(1);
      const row = existing[0];
      if (!row) {
        throw new DomainError("NOT_FOUND", "Library item not found.", "not_found");
      }
      const now = new Date();
      const next = {
        title: patch.title ?? row.title,
        description: patch.description === undefined ? row.description : patch.description,
        tagsJson: patch.tags === undefined ? row.tagsJson : JSON.stringify(patch.tags),
        updatedAt: now,
      };
      // The frozen-state invariant for metadata edits is the parent
      // group's `status === "active"` (a retired item still allows
      // metadata edits per the policy, but an archived group freezes
      // everything inside). Conditional UPDATE closes the SELECT-then-
      // UPDATE race against a concurrent `archive-group` mutation.
      const updated = await deps.db
        .update(libraryItems)
        .set(next)
        .where(
          and(
            eq(libraryItems.id, id),
            sql`EXISTS (SELECT 1 FROM ${groups} WHERE ${groups.id} = ${libraryItems.groupId} AND ${groups.status} = 'active')`,
          ),
        )
        .returning({ id: libraryItems.id });
      if (updated.length === 0) {
        throw new DomainError(
          "CONFLICT",
          "Archived groups do not allow metadata edits.",
          "group_archived",
        );
      }
      return toItem({ ...row, ...next });
    },

    async markRetired(id, by, at) {
      await deps.gate.assertWritable();
      // Conditional UPDATE — only fire when the row is currently living
      // so the second call is idempotent (no spurious updatedAt churn).
      const updated = await deps.db
        .update(libraryItems)
        .set({ retiredAt: at, retiredBy: by, updatedAt: at })
        .where(and(eq(libraryItems.id, id), sql`${libraryItems.retiredAt} IS NULL`))
        .returning();
      if (updated[0]) return toItem(updated[0]);

      const rows = await deps.db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) throw new DomainError("NOT_FOUND", "Library item not found.", "not_found");
      return toItem(row);
    },

    async addRevision({ libraryItemId, revision }: AddLibraryRevisionInput) {
      await deps.gate.assertWritable();
      const existing = await deps.db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, libraryItemId))
        .limit(1);
      const itemRow = existing[0];
      if (!itemRow) {
        throw new DomainError("NOT_FOUND", "Library item not found.", "not_found");
      }
      if (itemRow.retiredAt !== null) {
        throw new DomainError(
          "CONFLICT",
          "Retired items do not accept new revisions.",
          "library_item_retired",
        );
      }

      const maxRows = await deps.db
        .select({ n: sql<number>`coalesce(max(${libraryRevisions.revisionNumber}), 0)` })
        .from(libraryRevisions)
        .where(eq(libraryRevisions.libraryItemId, libraryItemId));
      const nextNumber = Number(maxRows[0]?.n ?? 0) + 1;

      const now = revision.uploadedAt;
      // Two-step transaction:
      // (1) INSERT the revision row first — UNIQUE (libraryItemId,
      //     revisionNumber) is the race guard against concurrent finalize
      //     calls picking the same number; a collision throws and the
      //     use case maps it to 409.
      // (2) Conditional UPDATE on the item — only fires when the item
      //     is still living. If a concurrent `markRetired` won the race
      //     between our pre-flight read and this UPDATE, the WHERE
      //     filters it out and `.returning()` is empty; throw CONFLICT
      //     so the caller knows the pointer didn't move. The orphan
      //     revision row is harmless: `currentRevisionId` still points
      //     at whatever was current at retire-time, and the orphan row
      //     is a leaf with no FK incoming.
      await deps.db.insert(libraryRevisions).values({
        id: revision.id,
        libraryItemId,
        revisionNumber: nextNumber,
        storageKey: revision.storageKey,
        mimeType: revision.mimeType,
        sizeBytes: revision.sizeBytes,
        originalFilename: revision.originalFilename,
        uploadedBy: revision.uploadedBy,
        uploadedAt: revision.uploadedAt,
      });
      const pointed = await deps.db
        .update(libraryItems)
        .set({ currentRevisionId: revision.id, updatedAt: now })
        .where(and(eq(libraryItems.id, libraryItemId), sql`${libraryItems.retiredAt} IS NULL`))
        .returning({ id: libraryItems.id });
      if (pointed.length === 0) {
        // Race lost: roll back the orphan revision row so the R2 key it
        // references doesn't leak past the next cron sweep cycle.
        await deps.db.delete(libraryRevisions).where(eq(libraryRevisions.id, revision.id));
        throw new DomainError(
          "CONFLICT",
          "Item was retired while the revision upload was in flight.",
          "library_item_retired",
        );
      }

      const inserted: LibraryRevision = {
        id: revision.id,
        libraryItemId,
        revisionNumber: nextNumber,
        storageKey: revision.storageKey,
        mimeType: revision.mimeType,
        sizeBytes: revision.sizeBytes,
        originalFilename: revision.originalFilename,
        uploadedBy: revision.uploadedBy,
        uploadedAt: revision.uploadedAt,
      };
      const item: LibraryItem = toItem({
        ...itemRow,
        currentRevisionId: revision.id,
        updatedAt: now,
      });
      return { revision: inserted, item };
    },

    async listRevisions(itemId) {
      const rows = await deps.db
        .select()
        .from(libraryRevisions)
        .where(eq(libraryRevisions.libraryItemId, itemId))
        .orderBy(desc(libraryRevisions.revisionNumber));
      return rows.map(toRevision);
    },

    async currentRevision(itemId) {
      const itemRows = await deps.db
        .select({ currentRevisionId: libraryItems.currentRevisionId })
        .from(libraryItems)
        .where(eq(libraryItems.id, itemId))
        .limit(1);
      const currentId = itemRows[0]?.currentRevisionId;
      if (!currentId) return null;
      const rows = await deps.db
        .select()
        .from(libraryRevisions)
        .where(eq(libraryRevisions.id, currentId))
        .limit(1);
      return rows[0] ? toRevision(rows[0]) : null;
    },

    async revisionById(revisionId) {
      const rows = await deps.db
        .select()
        .from(libraryRevisions)
        .where(eq(libraryRevisions.id, revisionId))
        .limit(1);
      return rows[0] ? toRevision(rows[0]) : null;
    },

    async addSteward({ libraryItemId, userId, grantedBy, grantedAt }: AddLibraryStewardInput) {
      await deps.gate.assertWritable();
      const id = ids.generate();
      // The UNIQUE `(library_item_id, user_id)` index is the duplicate
      // guard. ON CONFLICT DO NOTHING keeps the call idempotent — calling
      // twice surfaces the existing row to the caller.
      const inserted = await deps.db
        .insert(libraryStewards)
        .values({ id, libraryItemId, userId, grantedAt, grantedBy })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return toStewardship(inserted[0]);

      const existing = await deps.db
        .select()
        .from(libraryStewards)
        .where(
          and(eq(libraryStewards.libraryItemId, libraryItemId), eq(libraryStewards.userId, userId)),
        )
        .limit(1);
      if (!existing[0]) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          "Failed to insert or read steward row.",
          "steward_insert_failed",
        );
      }
      return toStewardship(existing[0]);
    },

    async removeSteward({ libraryItemId, userId }: RemoveLibraryStewardInput) {
      await deps.gate.assertWritable();
      await deps.db
        .delete(libraryStewards)
        .where(
          and(eq(libraryStewards.libraryItemId, libraryItemId), eq(libraryStewards.userId, userId)),
        );
    },

    async listStewards(itemId) {
      const rows = await deps.db
        .select()
        .from(libraryStewards)
        .where(eq(libraryStewards.libraryItemId, itemId))
        .orderBy(asc(libraryStewards.grantedAt));
      return rows.map(toStewardship);
    },

    async isSteward(itemId, userId) {
      const rows = await deps.db
        .select({ n: sql<number>`1` })
        .from(libraryStewards)
        .where(and(eq(libraryStewards.libraryItemId, itemId), eq(libraryStewards.userId, userId)))
        .limit(1);
      return rows.length > 0;
    },

    async usedInCount(itemId) {
      const rows = await deps.db
        .select({ n: sql<number>`count(*)` })
        .from(activityLibraryRefs)
        .where(eq(activityLibraryRefs.libraryItemId, itemId));
      return Number(rows[0]?.n ?? 0);
    },

    async search(groupId, options: LibrarySearchOptions): Promise<LibrarySearchPage> {
      const { query, limit, cursor } = options;
      const fetchSize = limit + 1;
      const cursorPosition = decodeSearchCursor(cursor);

      // Two-step query so Drizzle handles the column-mapping for
      // library_items rows. Step 1 raw-SQLs the FTS5 join to get hit
      // ids + rank + updated_at in result order (the only place we
      // can read FTS5's `rank` pseudo-column); step 2 fetches the full
      // typed rows via the schema-aware query builder.
      //
      // bm25 scores are negative — more negative means a stronger
      // match, so ASC = most relevant first. Tie-break by recency, then
      // id, so the cursor's three-tuple is total-order-stable across
      // concurrent inserts and updates.
      const matchExpr = query;
      const cursorPredicate = cursorPosition
        ? sql`AND (
            h.rank > ${cursorPosition.rank}
            OR (h.rank = ${cursorPosition.rank} AND li.updated_at < ${cursorPosition.updatedAtMs})
            OR (h.rank = ${cursorPosition.rank} AND li.updated_at = ${cursorPosition.updatedAtMs} AND li.id > ${cursorPosition.id})
          )`
        : sql``;

      type HitRow = {
        readonly library_item_id: string;
        readonly rank: number;
        readonly updated_at: number;
      };
      const hits = await deps.db.all<HitRow>(sql`
        WITH hits AS (
          SELECT library_item_id, rank
          FROM library_items_fts
          WHERE library_items_fts MATCH ${matchExpr}
        )
        SELECT h.library_item_id AS library_item_id, h.rank AS rank, li.updated_at AS updated_at
        FROM hits h
        JOIN library_items li ON li.id = h.library_item_id
        WHERE li.group_id = ${groupId}
          AND li.retired_at IS NULL
          ${cursorPredicate}
        ORDER BY h.rank ASC, li.updated_at DESC, li.id ASC
        LIMIT ${fetchSize}
      `);

      const visible = hits.slice(0, limit);
      const lastVisible = visible.at(-1);
      const nextCursor =
        hits.length > limit && lastVisible
          ? encodeSearchCursor({
              rank: lastVisible.rank,
              updatedAtMs: lastVisible.updated_at,
              id: lastVisible.library_item_id,
            })
          : null;

      if (visible.length === 0) return { entries: [], nextCursor };

      const orderedIds = visible.map((h) => h.library_item_id);
      const itemRows = await deps.db
        .select()
        .from(libraryItems)
        .where(inArray(libraryItems.id, orderedIds));
      const itemRowsById = new Map(itemRows.map((r) => [r.id, r] as const));
      const orderedRows = orderedIds
        .map((id) => itemRowsById.get(id))
        .filter((r): r is typeof libraryItems.$inferSelect => r !== undefined);

      const entries = await enrichListEntries(deps, orderedRows);
      return { entries, nextCursor };
    },

    async restoreFtsIndex() {
      // The full restore path: a `wrangler d1 export | execute --file -`
      // recreates library_items rows via INSERT, which fires the
      // mirror trigger and naturally repopulates library_items_fts —
      // no rebuild needed. This method is the defensive fallback for
      // drift between library_items and library_items_fts (a botched
      // import that bypassed triggers, an FTS segment file rotting on
      // disk, etc.). It wipes the index and rebuilds it row-by-row
      // from library_items, mirroring the AFTER INSERT trigger's
      // exact projection (every row, retired or living — the retired
      // filter lives at search time, not at index time).
      await deps.db.run(sql`DELETE FROM library_items_fts`);
      await deps.db.run(sql`
        INSERT INTO library_items_fts (library_item_id, title, description, tags)
        SELECT
          id,
          title,
          coalesce(description, ''),
          coalesce((SELECT group_concat(value, ' ') FROM json_each(tags_json)), '')
        FROM library_items
      `);
      const rows = await deps.db.select({ n: sql<number>`count(*)` }).from(libraryItems);
      return { rebuilt: Number(rows[0]?.n ?? 0) };
    },
  };
}

/**
 * Three keyset-style lookup queries plus the in-memory fold that the
 * `byGroup` and `search` paths both need to assemble `LibraryItemListEntry`
 * rows. Three small queries instead of a denormalized join: SQLite's
 * planner prefers IN over correlated sub-selects on a v1-sized library,
 * and the round-trip cost is dominated by D1 connection latency, which
 * the Promise.all amortizes.
 */
async function enrichListEntries(
  deps: Pick<CloudflareAdapterDeps, "db">,
  itemRows: ReadonlyArray<typeof libraryItems.$inferSelect>,
): Promise<LibraryItemListEntry[]> {
  if (itemRows.length === 0) return [];

  const orderedIds = itemRows.map((r) => r.id);
  const currentRevisionIds = itemRows
    .map((r) => r.currentRevisionId)
    .filter((v): v is string => v !== null);

  const [revisionRows, stewardRows, usedInRows] = await Promise.all([
    currentRevisionIds.length === 0
      ? Promise.resolve([] as Array<typeof libraryRevisions.$inferSelect>)
      : deps.db
          .select()
          .from(libraryRevisions)
          .where(inArray(libraryRevisions.id, currentRevisionIds)),
    deps.db
      .select({
        libraryItemId: libraryStewards.libraryItemId,
        count: sql<number>`count(*)`,
      })
      .from(libraryStewards)
      .where(inArray(libraryStewards.libraryItemId, orderedIds))
      .groupBy(libraryStewards.libraryItemId),
    deps.db
      .select({
        libraryItemId: activityLibraryRefs.libraryItemId,
        count: sql<number>`count(*)`,
      })
      .from(activityLibraryRefs)
      .where(inArray(activityLibraryRefs.libraryItemId, orderedIds))
      .groupBy(activityLibraryRefs.libraryItemId),
  ]);

  const revisionByItemId = new Map<string, LibraryRevision>();
  for (const r of revisionRows) {
    revisionByItemId.set(r.libraryItemId, toRevision(r));
  }
  const stewardCountByItemId = new Map<string, number>(
    stewardRows.map((r) => [r.libraryItemId, Number(r.count)]),
  );
  const usedInByItemId = new Map<string, number>(
    usedInRows.map((r) => [r.libraryItemId, Number(r.count)]),
  );

  return itemRows.map((row) => ({
    item: toItem(row),
    currentRevision: revisionByItemId.get(row.id) ?? null,
    stewardCount: stewardCountByItemId.get(row.id) ?? 0,
    usedInCount: usedInByItemId.get(row.id) ?? 0,
  }));
}

type SearchCursor = {
  readonly rank: number;
  readonly updatedAtMs: number;
  readonly id: string;
};

function encodeSearchCursor(cursor: SearchCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeSearchCursor(encoded: string | null): SearchCursor | null {
  if (encoded === null) return null;
  try {
    const decoded = JSON.parse(atob(encoded)) as unknown;
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "rank" in decoded &&
      "updatedAtMs" in decoded &&
      "id" in decoded &&
      typeof decoded.rank === "number" &&
      typeof decoded.updatedAtMs === "number" &&
      typeof decoded.id === "string"
    ) {
      return decoded as SearchCursor;
    }
    return null;
  } catch {
    return null;
  }
}
