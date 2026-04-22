/**
 * Authoritative barrel for the Drizzle schema. drizzle.config.ts points at
 * this file. DO NOT add named re-exports or table definitions here — only
 * `export * from "./..."` re-exports. Adding named re-exports while the
 * barrel also re-exports the same module causes drizzle-kit to see
 * duplicate tables and fail silently (drizzle-orm#5353).
 */
export * from "./auth-tables.ts";
export * from "./schema/activities.ts";
export * from "./schema/groups.ts";
export * from "./schema/instance.ts";
export * from "./schema/invitations.ts";
export * from "./schema/library.ts";
export * from "./schema/records.ts";
export * from "./schema/study-sessions.ts";
export * from "./schema/system.ts";
export * from "./schema/tracks.ts";
