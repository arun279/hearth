import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";
import { groups } from "./groups.ts";
import { tracks } from "./tracks.ts";

// Invitations live here (rather than in groups.ts) because they reference
// both groups and tracks. Keeping them with their two FKs in a shared file
// avoids a groups.ts ↔ tracks.ts import cycle.
export const groupInvitations = sqliteTable(
  "group_invitations",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    trackId: text("track_id").references(() => tracks.id),
    token: text("token").notNull().unique(),
    email: text("email"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
    consumedBy: text("consumed_by").references(() => users.id),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokedBy: text("revoked_by").references(() => users.id),
  },
  (t) => [index("group_invitations_expires_idx").on(t.expiresAt)],
);
