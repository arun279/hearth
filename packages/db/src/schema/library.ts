import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";
import { groups } from "./groups.ts";

export const libraryItems = sqliteTable(
  "library_items",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    title: text("title").notNull(),
    description: text("description"),
    tagsJson: text("tags_json").notNull(),
    currentRevisionId: text("current_revision_id"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
    retiredBy: text("retired_by").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    /**
     * Partial index — only living items participate in `byGroup` reads.
     * Retired items still need to be reachable by id (download links on
     * historical activity records), but the group library page filters
     * them out by default and partial-indexing avoids paying their cost
     * on the hot read path.
     */
    index("library_items_active_by_group_idx").on(t.groupId).where(sql`${t.retiredAt} IS NULL`),
  ],
);

export const libraryRevisions = sqliteTable(
  "library_revisions",
  {
    id: text("id").primaryKey(),
    libraryItemId: text("library_item_id")
      .notNull()
      .references(() => libraryItems.id),
    revisionNumber: integer("revision_number").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    originalFilename: text("original_filename"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("library_revisions_item_number_idx").on(t.libraryItemId, t.revisionNumber)],
);

export const libraryStewards = sqliteTable(
  "library_stewards",
  {
    id: text("id").primaryKey(),
    libraryItemId: text("library_item_id")
      .notNull()
      .references(() => libraryItems.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [uniqueIndex("library_stewards_item_user_idx").on(t.libraryItemId, t.userId)],
);

// NOTE: library_items_fts (FTS5 virtual table + triggers) is hand-written SQL in migrations/,
// NOT managed by Drizzle. Drizzle's FTS5 support is weak and would emit DROP TABLE on every diff.

// Short-lived coordination row for the 4-step direct-to-R2 upload flow:
// (1) client requests a presigned URL which inserts a row here; (2) client
// uploads directly to R2; (3) client calls finalize which materializes
// library_items + library_revisions and deletes the row; (4) hourly cron
// sweeps rows past `expiresAt` and deletes the orphan R2 object.
export const pendingUploads = sqliteTable(
  "pending_uploads",
  {
    id: text("id").primaryKey(),
    uploaderUserId: text("uploader_user_id")
      .notNull()
      .references(() => users.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    libraryItemId: text("library_item_id").references(() => libraryItems.id),
    revisionId: text("revision_id").notNull(),
    declaredSizeBytes: integer("declared_size_bytes").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    originalFilename: text("original_filename"),
    context: text("context").notNull(),
    pendingContributionId: text("pending_contribution_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("pending_uploads_expires_at_idx").on(t.expiresAt),
    check(
      "pending_uploads_context",
      sql`${t.context} IN ('library', 'pending_contribution', 'avatar')`,
    ),
  ],
);
