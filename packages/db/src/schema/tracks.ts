import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";
import { groups } from "./groups.ts";

export const tracks = sqliteTable(
  "tracks",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    trackStructureJson: text("track_structure_json").notNull(),
    contributionPolicyJson: text("contribution_policy_json").notNull(),
    pausedAt: integer("paused_at", { mode: "timestamp_ms" }),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    archivedBy: text("archived_by").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("tracks_group_status_idx").on(t.groupId, t.status),
    check("tracks_status", sql`${t.status} IN ('active', 'paused', 'archived')`),
  ],
);

export const trackEnrollments = sqliteTable(
  "track_enrollments",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("participant"),
    enrolledAt: integer("enrolled_at", { mode: "timestamp_ms" }).notNull(),
    leftAt: integer("left_at", { mode: "timestamp_ms" }),
    leftBy: text("left_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("track_enrollments_track_user_idx").on(t.trackId, t.userId),
    index("track_enrollments_user_idx").on(t.userId),
    // Partial index covering the hot read path: count active facilitators
    // per track (orphan guard) and list active facilitators on the People
    // tab. Drops `leftAt IS NULL` rows from the scan so the count is
    // O(active facilitators) instead of O(all enrollments per track).
    index("track_enrollments_active_facilitator_idx")
      .on(t.trackId, t.role)
      .where(sql`${t.leftAt} IS NULL`),
    check("track_enrollments_role", sql`${t.role} IN ('participant', 'facilitator')`),
  ],
);

export const pendingContributions = sqliteTable(
  "pending_contributions",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    reviewedBy: text("reviewed_by").references(() => users.id),
  },
  (t) => [
    index("pending_contributions_track_status_idx").on(t.trackId, t.status),
    check(
      "pending_contributions_status",
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
  ],
);
