import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";

/** Single-row instance settings. CHECK enforces singleton. */
export const instanceSettings = sqliteTable(
  "instance_settings",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().default("Hearth"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    updatedBy: text("updated_by").references(() => users.id),
  },
  (t) => [check("instance_settings_singleton", sql`${t.id} = 'instance'`)],
);

export const approvedEmails = sqliteTable("approved_emails", {
  email: text("email").primaryKey(),
  addedBy: text("added_by")
    .notNull()
    .references(() => users.id),
  addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  note: text("note"),
});

export const instanceOperators = sqliteTable("instance_operators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
  grantedBy: text("granted_by")
    .notNull()
    .references(() => users.id),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});
