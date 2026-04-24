#!/usr/bin/env node
/**
 * Local-dev helper: add an email to the `approved_emails` table so it can
 * sign in. This is a temporary convenience until the operator admin surface
 * lands (adds full email + operator management via the API and SPA).
 *
 * Usage: pnpm approve-email <email> ["optional note"]
 *
 * Requires that at least one instance operator already exists (the bootstrap
 * sign-in creates the first one). The added row is attributed to that
 * operator via `added_by` so FK constraints are satisfied.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const [, , rawEmail, ...noteParts] = process.argv;
if (!rawEmail) {
  console.error("Usage: pnpm approve-email <email> [note]");
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
const note = noteParts.join(" ").replace(/'/g, "''") || null;

function wrangler(sql) {
  return spawnSync(
    "pnpm",
    [
      "--filter",
      "@hearth/worker",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "hearth",
      "--local",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8" },
  );
}

const opRes = wrangler(
  "SELECT user_id AS id FROM instance_operators WHERE revoked_at IS NULL LIMIT 1",
);
if (opRes.status !== 0) {
  console.error("wrangler d1 execute failed:");
  console.error(opRes.stderr || opRes.stdout);
  process.exit(opRes.status ?? 1);
}
const parsed = JSON.parse(opRes.stdout);
const rows = parsed?.[0]?.results ?? [];
if (rows.length === 0) {
  console.error(
    "No active instance operator found. Sign in with the bootstrap email first, then re-run.",
  );
  process.exit(1);
}
const addedBy = rows[0].id;

const noteSql = note ? `'${note}'` : "NULL";
const insertRes = wrangler(
  `INSERT OR IGNORE INTO approved_emails (email, added_by, added_at, note) VALUES ('${email}', '${addedBy}', strftime('%s','now')*1000, ${noteSql})`,
);
if (insertRes.status !== 0) {
  console.error(insertRes.stderr || insertRes.stdout);
  process.exit(insertRes.status ?? 1);
}

console.log(`Approved email: ${email}`);
