import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Better Auth tables — the `@better-auth/cli generate` drift check (CI) diffs
 * its output against THIS file. Keep this file flat (no barrel tricks, no
 * cross-file imports) and Better-Auth-only.
 *
 * Property names MUST match Better Auth's logical field names exactly
 * (better-auth#4211, #5386). Physical column names are snake_case via
 * Drizzle's first argument.
 */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    name: text("name"),
    image: text("image"),

    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),

    deactivatedAt: integer("deactivated_at", { mode: "timestamp_ms" }),
    deactivatedBy: text("deactivated_by").references((): AnySQLiteColumn => users.id),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedBy: text("deleted_by").references((): AnySQLiteColumn => users.id),
    attributionPreference: text("attribution_preference").notNull().default("preserve_name"),
    visibilityPreferenceJson: text("visibility_preference_json"),
  },
  (t) => [
    check(
      "users_attribution_preference",
      sql`${t.attributionPreference} IN ('preserve_name', 'anonymize')`,
    ),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
