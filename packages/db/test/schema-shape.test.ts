import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema.ts";

/**
 * Canonical table inventory. Maintained here rather than in a separate config
 * so the source-of-truth lives next to the tests that read it.
 */
const EXPECTED_TABLES = [
  // Better Auth
  "users",
  "sessions",
  "accounts",
  "verifications",
  // Instance
  "instance_settings",
  "approved_emails",
  "instance_operators",
  // Groups
  "groups",
  "group_memberships",
  "group_invitations",
  // Tracks
  "tracks",
  "track_enrollments",
  "pending_contributions",
  // Library
  "library_items",
  "library_revisions",
  "library_stewards",
  "pending_uploads",
  // Activities
  "learning_activities",
  "activity_library_refs",
  "activity_prerequisites",
  "activity_suggested_sequences",
  // Records
  "activity_records",
  "part_progress",
  "part_history",
  "evidence_signals",
  // Study sessions
  "study_sessions",
  "study_session_activities",
  "session_attendance",
  // System
  "system_flags",
  "usage_snapshots",
] as const;

/**
 * Tables that legitimately have a composite primary key. Any NEW composite
 * PK must be added here explicitly and the reason documented in the schema
 * file's comment.
 */
const ALLOWED_COMPOSITE_PK_TABLES = new Set<string>([
  // Currently none — surrogate id + UNIQUE composite is the default to avoid
  // Drizzle's ON CONFLICT bugs on composite targets (drizzle-orm #4427, #475).
]);

function collectTables() {
  const tables: Array<{ name: string; primaryKeyCols: number }> = [];
  for (const value of Object.values(schema)) {
    if (value && typeof value === "object" && is(value, SQLiteTable)) {
      const cfg = getTableConfig(value as SQLiteTable);
      const primaryKeyCols =
        cfg.columns.filter((c) => c.primary).length +
        cfg.primaryKeys.reduce((n, pk) => n + pk.columns.length, 0);
      tables.push({ name: cfg.name, primaryKeyCols });
    }
  }
  return tables;
}

describe("schema inventory", () => {
  const tables = collectTables();
  const names = new Set(tables.map((t) => t.name));

  it("contains exactly the expected table set", () => {
    const expected = new Set<string>(EXPECTED_TABLES);
    const missing = [...expected].filter((t) => !names.has(t));
    const extra = [...names].filter((t) => !expected.has(t));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("has no accidental composite primary keys", () => {
    const violators = tables
      .filter((t) => t.primaryKeyCols > 1 && !ALLOWED_COMPOSITE_PK_TABLES.has(t.name))
      .map((t) => t.name);
    expect(violators).toEqual([]);
  });
});
