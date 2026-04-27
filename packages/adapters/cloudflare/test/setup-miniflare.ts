import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

/**
 * Augment the `cloudflare:test` module with the bindings we declare in
 * `wrangler.test.jsonc` so `env.DB` and friends are typed in every suite.
 */
declare module "cloudflare:test" {
  interface ProvidedEnv {
    readonly DB: D1Database;
    readonly STORAGE: R2Bucket;
    readonly TEST_MIGRATIONS: D1Migration[];
  }
}

/**
 * Setup files run OUTSIDE isolated storage, so this module-level await is the
 * documented pattern — migrations land once on the shared D1 and every test
 * sees them through its own isolated snapshot. `applyD1Migrations` is
 * idempotent; re-running on watch mode applies only what's new.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/**
 * D1 storage is NOT auto-isolated per test (only KV / R2 / Durable Objects
 * get that treatment by default). Truncate the aggregate tables between
 * tests so each case starts from a known-empty state.
 *
 * Order matches the reverse dependency graph: children before parents,
 * parents last, so SQLite's end-of-statement FK checks are satisfied. The
 * `library_items_fts` rows are cleaned by the AFTER DELETE trigger from
 * migration `0001_library_fts5.sql` — that's part of what the FTS5 suite
 * exercises.
 */
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM library_items"),
    env.DB.prepare("DELETE FROM instance_operators"),
    env.DB.prepare("DELETE FROM approved_emails"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM accounts"),
    // instance_settings is a singleton — reset its user FK before the users
    // table is truncated so the FK to updated_by does not block the delete.
    env.DB.prepare(
      "UPDATE instance_settings SET name = 'Hearth', updated_by = NULL, updated_at = 0 WHERE id = 'instance'",
    ),
    env.DB.prepare("DELETE FROM pending_uploads"),
    env.DB.prepare("DELETE FROM group_invitations"),
    env.DB.prepare("DELETE FROM group_memberships"),
    env.DB.prepare("DELETE FROM track_enrollments"),
    env.DB.prepare("DELETE FROM tracks"),
    env.DB.prepare("DELETE FROM groups"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});
