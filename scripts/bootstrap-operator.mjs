#!/usr/bin/env node
/**
 * Idempotently ensure the configured bootstrap email is an active
 * instance operator with an approved-email entry. Runs against the
 * local Miniflare D1 by default, or against the deployed D1 via
 * `--remote`. Safe to re-run.
 *
 * Usage:
 *   pnpm bootstrap-operator                # local D1
 *   pnpm bootstrap-operator --remote       # production D1 (wrangler d1 --remote)
 *   pnpm bootstrap-operator --check        # exit 1 if bootstrap email is not
 *                                          # both approved and an active operator
 *
 * Why this exists: the auth hook's bootstrap-bypass admits the first
 * sign-in when the bootstrap env var matches. If that admission table
 * later gets wiped (e.g., a local-dev cleanup that takes `.wrangler/`
 * with it, or a manual revoke in prod) and the operator hasn't signed
 * in to re-bootstrap, the maintainer is locked out. This script restores
 * the entries without requiring a sign-in, provided the maintainer's
 * `users` row still exists.
 *
 * For first-ever bootstrap (no `users` row yet), the OAuth sign-in flow
 * still handles it via the bootstrap-bypass + `user.create.after` seed.
 * This script never creates `users` rows — Better Auth owns those.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEV_VARS_PATH = path.join(REPO_ROOT, "apps/worker/.dev.vars");

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const email = resolveBootstrapEmail(args);
if (!email) {
  fail(
    "HEARTH_BOOTSTRAP_OPERATOR_EMAIL is not set. Configure it in .dev.vars (local) or as a Workers secret (remote) before running this script.",
  );
}

const scope = args.remote ? "remote" : "local";
const userRow = findUserByEmail(email, scope);

if (!userRow) {
  if (args.check) {
    fail(
      `No user row exists for ${email} on ${scope}. Sign in via OAuth once to create it, then re-run.`,
    );
  }
  fail(
    [
      `No user row exists for ${email} on ${scope}.`,
      "This script restores admission entries for an existing user — it does not create the user row (Better Auth owns that).",
      "Sign in once via OAuth so Better Auth creates the user row, then re-run this script (or rely on the auth hook's bootstrap-bypass).",
    ].join("\n"),
  );
}

const userId = userRow.id;
const approved = isEmailApproved(email, scope);
const operator = isActiveOperator(userId, scope);

if (args.check) {
  if (approved && operator) {
    process.stdout.write(`OK: ${email} is approved and an active operator on ${scope}.\n`);
    process.exit(0);
  }
  const missing = [
    !approved ? "approved_emails entry" : null,
    !operator ? "active instance_operators entry" : null,
  ]
    .filter(Boolean)
    .join(" + ");
  fail(
    `${email} on ${scope} is missing: ${missing}. Run \`pnpm bootstrap-operator${args.remote ? " --remote" : ""}\` to restore.`,
  );
}

if (approved && operator) {
  process.stdout.write(
    `Already bootstrapped: ${email} is approved and an active operator on ${scope}.\n`,
  );
  process.exit(0);
}

upsertBootstrap({ email, userId, scope });

process.stdout.write(`Bootstrapped: ${email} on ${scope} (user_id=${userId}).\n`);
process.exit(0);

// ---------- helpers ----------

function parseArgs(argv) {
  const out = { remote: false, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--remote") out.remote = true;
    else if (a === "--local") out.remote = false;
    else if (a === "--check") out.check = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--email=")) out.email = a.slice("--email=".length);
    else if (a === "--email") {
      out.email = argv[++i];
    } else fail(`Unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    `pnpm bootstrap-operator [--local|--remote] [--check] [--email <addr>]\n\n` +
      `Idempotently ensure the bootstrap email has approved_emails + instance_operators entries.\n` +
      `Reads HEARTH_BOOTSTRAP_OPERATOR_EMAIL from .dev.vars (local) or wrangler secret env (remote)\n` +
      `unless --email overrides.\n\n` +
      `--check exits non-zero if the bootstrap operator is missing either entry. Use as a pre-push or CI gate.\n`,
  );
}

function resolveBootstrapEmail(args) {
  if (args.email) return canonicalize(args.email);
  if (args.remote) {
    const fromEnv = process.env.HEARTH_BOOTSTRAP_OPERATOR_EMAIL;
    if (fromEnv) return canonicalize(fromEnv);
    return null;
  }
  return readDevVar("HEARTH_BOOTSTRAP_OPERATOR_EMAIL");
}

function canonicalize(raw) {
  return raw.trim().toLowerCase();
}

function readDevVar(key) {
  let content;
  try {
    content = readFileSync(DEV_VARS_PATH, "utf8");
  } catch {
    return null;
  }
  const line = content.split("\n").find((l) => l.startsWith(`${key}=`));
  if (!line) return null;
  const raw = line
    .slice(`${key}=`.length)
    .trim()
    .replace(/^["']|["']$/g, "");
  return raw ? canonicalize(raw) : null;
}

function wranglerArgs(scope, command) {
  return [
    "--filter",
    "@hearth/worker",
    "exec",
    "wrangler",
    "d1",
    "execute",
    "hearth",
    scope === "remote" ? "--remote" : "--local",
    "--json",
    "--command",
    command,
  ];
}

function executeSqlJson(sql, scope) {
  const res = spawnSync("pnpm", wranglerArgs(scope, sql), { cwd: REPO_ROOT, encoding: "utf8" });
  if (res.status !== 0) {
    fail(res.stderr || res.stdout || "wrangler d1 execute failed");
  }
  return JSON.parse(res.stdout);
}

function findUserByEmail(email, scope) {
  const out = executeSqlJson(
    `SELECT id FROM users WHERE email = '${q(email)}' AND deleted_at IS NULL LIMIT 1`,
    scope,
  );
  const rows = out?.[0]?.results ?? [];
  return rows[0] ?? null;
}

function isEmailApproved(email, scope) {
  const out = executeSqlJson(
    `SELECT 1 AS x FROM approved_emails WHERE email = '${q(email)}' LIMIT 1`,
    scope,
  );
  return (out?.[0]?.results?.length ?? 0) > 0;
}

function isActiveOperator(userId, scope) {
  const out = executeSqlJson(
    `SELECT 1 AS x FROM instance_operators WHERE user_id = '${q(userId)}' AND revoked_at IS NULL LIMIT 1`,
    scope,
  );
  return (out?.[0]?.results?.length ?? 0) > 0;
}

function upsertBootstrap({ email, userId, scope }) {
  const now = Date.now();
  const statements = [
    `INSERT OR IGNORE INTO approved_emails (email, added_by, added_at, note)
     VALUES ('${q(email)}', '${q(userId)}', ${now}, 'bootstrap-operator script')`,
    `INSERT OR IGNORE INTO instance_operators (user_id, granted_at, granted_by, revoked_at)
     VALUES ('${q(userId)}', ${now}, '${q(userId)}', NULL)`,
    // If a prior revoke left a row in place, un-revoke it so the user is active again.
    `UPDATE instance_operators
     SET revoked_at = NULL, revoked_by = NULL
     WHERE user_id = '${q(userId)}' AND revoked_at IS NOT NULL`,
  ];
  executeSqlJson(statements.join("; "), scope);
}

function q(s) {
  return String(s).replace(/'/g, "''");
}

function fail(msg) {
  process.stderr.write(`bootstrap-operator: ${msg}\n`);
  process.exit(1);
}
