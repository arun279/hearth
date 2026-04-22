import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    admissionPolicy: text("admission_policy").notNull().default("invite_only"),
    status: text("status").notNull().default("active"),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    archivedBy: text("archived_by").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    check("groups_admission_policy", sql`${t.admissionPolicy} IN ('open', 'invite_only')`),
    check("groups_status", sql`${t.status} IN ('active', 'archived')`),
  ],
);

export const groupMemberships = sqliteTable(
  "group_memberships",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("participant"),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
    removedAt: integer("removed_at", { mode: "timestamp_ms" }),
    removedBy: text("removed_by").references(() => users.id),
    attributionOnLeave: text("attribution_on_leave"),
    displayNameSnapshot: text("display_name_snapshot"),
    profileNickname: text("profile_nickname"),
    profileAvatarUrl: text("profile_avatar_url"),
    profileBio: text("profile_bio"),
    profileUpdatedAt: integer("profile_updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("group_memberships_group_user_idx").on(t.groupId, t.userId),
    index("group_memberships_user_idx").on(t.userId),
    check("group_memberships_role", sql`${t.role} IN ('participant', 'admin')`),
    check(
      "group_memberships_attribution_on_leave",
      sql`${t.attributionOnLeave} IS NULL OR ${t.attributionOnLeave} IN ('preserve_name', 'anonymize')`,
    ),
  ],
);

// NOTE: group_invitations lives in invitations.ts — it references both groups
// and tracks, and keeping it there avoids a groups ↔ tracks import cycle.
