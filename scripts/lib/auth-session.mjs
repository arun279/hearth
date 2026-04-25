/**
 * Dev/test auth seam — the one place that knows how to sign a Better Auth
 * session cookie and seed the user/operator/approved-email rows that prod's
 * OAuth flow would normally create.
 *
 * Production sign-in goes through `@hearth/auth` + Better Auth's OAuth
 * handlers in the Worker. That path is the source of truth and we don't
 * touch it. This module is the *extension* used by Playwright e2e tests
 * (`apps/web/e2e/auth.ts`) and the dev CLI (`scripts/local-session.mjs`)
 * to bypass the OAuth dance — Google has no headless test mode — while
 * producing a cookie the running Worker accepts as legitimate.
 *
 * Single-source-of-truth invariant: HMAC, schema knowledge, and the
 * wrangler-d1 plumbing live ONLY here. Both consumers import from this
 * file. If you find yourself re-implementing `signSessionToken` or
 * `seedOperator` in a third place, import them instead.
 *
 * SQL is built via string interpolation because `wrangler d1 execute
 * --command` has no parameter binding. Every interpolated value goes
 * through `q()`, which is correct for SQLite (the only escape rule is to
 * double single quotes). Inputs reaching this module are constrained
 * (regex-narrowed user ids, lowercased trimmed emails, controlled
 * callsites in test/dev tooling). Architecture Analyst's recommendation
 * (2026-04) was to keep wrangler CLI subprocess over `better-sqlite3`
 * because the local D1 sqlite path is not a public CF interface; the
 * batched-statements optimisation is applied here.
 */
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEV_VARS_PATH = path.join(REPO_ROOT, "apps/worker/.dev.vars");
export const BETTER_AUTH_SESSION_COOKIE = "better-auth.session_token";

/**
 * Escape a value for inclusion in a SQLite single-quoted string literal.
 * SQLite's only required escape is doubling single quotes; backslashes are
 * literal. Apply to *every* user-controlled string before interpolation.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function q(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * Read a key=value line from `apps/worker/.dev.vars`. Strips surrounding
 * single or double quotes and trims whitespace.
 *
 * @param {string} key
 * @param {string} [devVarsPath] override for tests
 * @returns {string}
 */
export function readDevVar(key, devVarsPath = DEV_VARS_PATH) {
  const lines = readFileSync(devVarsPath, "utf8").split("\n");
  const line = lines.find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not found in ${devVarsPath}`);
  return line
    .slice(`${key}=`.length)
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Run one or more SQL statements against the local Miniflare D1 via
 * `wrangler d1 execute --local`. An array is joined with `;` so a single
 * subprocess handles the batch — that's the perf optimisation Architecture
 * Analyst recommended over reaching into wrangler's sqlite file directly.
 *
 * @param {string | readonly string[]} sql
 */
export function executeSql(sql) {
  const command = Array.isArray(sql) ? sql.join("; ") : sql;
  const res = spawnSync(
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
      "--command",
      command,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || "wrangler d1 execute failed");
  }
}

/**
 * Like `executeSql` but returns wrangler's parsed JSON result. Use for
 * SELECTs.
 *
 * @param {string} sql
 * @returns {Array<{ results: unknown[] }>}
 */
function executeSqlJson(sql) {
  const res = spawnSync(
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
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || "wrangler d1 execute failed");
  }
  return JSON.parse(res.stdout);
}

/**
 * @param {string} email
 * @returns {{ id: string } | null}
 */
export function findUserByEmail(email) {
  const out = executeSqlJson(`SELECT id FROM users WHERE email = '${q(email)}' LIMIT 1`);
  const row = out?.[0]?.results?.[0];
  return row && typeof row === "object" && "id" in row ? /** @type {{id: string}} */ (row) : null;
}

/**
 * @param {string} userId
 * @returns {boolean}
 */
export function isInstanceOperator(userId) {
  const out = executeSqlJson(
    `SELECT 1 AS x FROM instance_operators WHERE user_id = '${q(userId)}' AND revoked_at IS NULL LIMIT 1`,
  );
  return (out?.[0]?.results?.length ?? 0) > 0;
}

/**
 * Idempotently insert user + instance_operator + approved_emails rows for
 * the given identity. Mirrors the rows the OAuth-then-bootstrap flow
 * creates, but skips OAuth.
 *
 * @param {{ userId: string, email: string, name: string, now?: number }} args
 */
function seedOperator({ userId, email, name, now = Date.now() }) {
  executeSql([
    `INSERT OR IGNORE INTO users (id, email, email_verified, name, image, created_at, updated_at)
     VALUES ('${q(userId)}', '${q(email)}', 0, '${q(name)}', NULL, ${now}, ${now})`,
    `INSERT OR IGNORE INTO instance_operators (user_id, granted_at, granted_by, revoked_at)
     VALUES ('${q(userId)}', ${now}, '${q(userId)}', NULL)`,
    `INSERT OR IGNORE INTO approved_emails (email, added_by, added_at, note)
     VALUES ('${q(email)}', '${q(userId)}', ${now}, 'auth-session seed')`,
  ]);
}

/**
 * Drop a user's sessions, group memberships, and any group whose only
 * member was that user. Lets dev/test scripts start from a known clean
 * slate without nuking other users' data. Mirrors the e2e teardown shape
 * but scoped to a single user.
 *
 * @param {string} userId
 */
function resetUserState(userId) {
  executeSql([
    `DELETE FROM sessions WHERE user_id = '${q(userId)}'`,
    `DELETE FROM group_memberships WHERE user_id = '${q(userId)}'`,
    `DELETE FROM groups WHERE id NOT IN (SELECT DISTINCT group_id FROM group_memberships)`,
  ]);
}

/**
 * Insert a fresh session row whose token will sign the cookie. The token
 * is opaque — Better Auth verifies the HMAC, then looks up the row by
 * token. Caller is expected to have ensured the user exists.
 *
 * @param {{ userId: string, token: string, idPrefix?: string, ttlMs?: number, now?: number }} args
 */
function insertSession({
  userId,
  token,
  idPrefix = "s_local_",
  ttlMs = 86_400_000,
  now = Date.now(),
}) {
  const id = `${idPrefix}${userId}_${now}`;
  executeSql(
    `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
     VALUES ('${q(id)}', '${q(userId)}', '${q(token)}', ${now + ttlMs}, '127.0.0.1', 'auth-session', ${now}, ${now})`,
  );
}

/**
 * Sign a session token with HMAC-SHA256(BETTER_AUTH_SECRET, token) — the
 * exact shape Better Auth verifies on the way in. The signature is
 * Base64-encoded; Better Auth's cookie format is `${token}.${sigB64}`.
 *
 * Pure function: same inputs → same output. Useful for unit testing.
 *
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<string>} signed cookie value (token.sigB64)
 */
export async function signSessionToken(token, secret) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return `${token}.${Buffer.from(sig).toString("base64")}`;
}

/**
 * Convenience: sign with BETTER_AUTH_SECRET read from .dev.vars.
 *
 * @param {string} token
 * @returns {Promise<string>}
 */
async function signSessionTokenFromDevVars(token) {
  return signSessionToken(token, readDevVar("BETTER_AUTH_SECRET"));
}

/**
 * High-level: ensure a user exists, mint a fresh session row, and return
 * the signed cookie value (URL-encoded, ready to drop into `Set-Cookie`
 * or Playwright `context.addCookies`).
 *
 * @param {{
 *   userId: string,
 *   email: string,
 *   name: string,
 *   asOperator?: boolean,
 *   reset?: boolean,
 *   idPrefix?: string,
 * }} args
 * @returns {Promise<{ cookie: string, sessionToken: string, userId: string }>}
 */
export async function mintSessionCookie(args) {
  if (args.reset) {
    const existing = findUserByEmail(args.email);
    if (existing) resetUserState(existing.id);
  }
  if (args.asOperator !== false) {
    seedOperator({ userId: args.userId, email: args.email, name: args.name });
  }
  const user = findUserByEmail(args.email);
  if (!user) {
    throw new Error(`No user found for ${args.email} (and seed was disabled).`);
  }
  const sessionToken = `tk_${(args.idPrefix ?? "s_local_").replace(/^s_/, "")}${user.id}_${Date.now()}`;
  insertSession({ userId: user.id, token: sessionToken, idPrefix: args.idPrefix });
  const signed = await signSessionTokenFromDevVars(sessionToken);
  return { cookie: encodeURIComponent(signed), sessionToken, userId: user.id };
}
