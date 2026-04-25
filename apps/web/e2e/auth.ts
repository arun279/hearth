import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEV_VARS = path.join(REPO_ROOT, "apps/worker/.dev.vars");

/**
 * Reads a key from `apps/worker/.dev.vars`. Used to mint a Better Auth signed
 * cookie that the local Worker will accept — same code path the real OAuth
 * flow takes after Better Auth establishes a session.
 */
function readDevVar(key: string): string {
  const lines = readFileSync(DEV_VARS, "utf8").split("\n");
  const line = lines.find((l: string) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not found in ${DEV_VARS}`);
  return line
    .slice(`${key}=`.length)
    .trim()
    .replace(/^["']|["']$/g, "");
}

const BETTER_AUTH_SESSION_COOKIE = "better-auth.session_token";

async function signSessionToken(token: string): Promise<string> {
  const secret = readDevVar("BETTER_AUTH_SECRET");
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const sigB64 = Buffer.from(sig).toString("base64");
  return `${token}.${sigB64}`;
}

/**
 * Runs a SQL command against the local Miniflare D1 via `wrangler d1 execute`.
 * Avoids talking to D1 directly because the Worker dev server has it open;
 * wrangler manages locking.
 */
function executeSql(sql: string): void {
  execFileSync(
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
      sql,
    ],
    { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "ignore"] },
  );
}

/**
 * Removes prior test-seeded rows so each spec starts from a known baseline.
 *
 * Every destructive statement is scoped to test-data identifiers
 * (`u_e2e_*` user ids, `s_e2e_*` session ids, `a_e2e_*` account ids,
 * `*@e2e.example.com` emails). The local Miniflare D1 is the same
 * database a developer signed in to via `wrangler dev`; a non-scoped
 * teardown (the prior shape) wiped real users' operator status and
 * approved-email rows during dev, leaving the developer signed in but
 * stripped of operator powers. A non-scoped `DELETE FROM groups` /
 * `DELETE FROM group_memberships` would do the same to real groups.
 *
 * Order is FK-safe (children before parents): sessions / accounts /
 * operators / approved-emails / instance-settings reference release
 * → group memberships → groups → users.
 */
export function resetInstanceState(): void {
  executeSql(
    [
      "DELETE FROM sessions WHERE id LIKE 's_e2e_%' OR user_id LIKE 'u_e2e_%'",
      "DELETE FROM accounts WHERE id LIKE 'a_e2e_%' OR user_id LIKE 'u_e2e_%'",
      "DELETE FROM instance_operators WHERE user_id LIKE 'u_e2e_%'",
      "DELETE FROM approved_emails WHERE email LIKE '%@e2e.example.com'",
      // Reset the singleton instance-settings row so the M1 rename spec
      // can assert an "Hearth" baseline. Losing a renamed instance is
      // recoverable in a dev DB (just rename again); losing operator
      // status was not — that was the lockout this fix addresses.
      "UPDATE instance_settings SET name = 'Hearth', updated_by = NULL, updated_at = 0 WHERE id = 'instance'",
      // E2e memberships first; then groups whose remaining membership
      // count is zero (orphaned by the membership delete) — those are
      // the e2e-only groups. A group that still has any non-e2e member
      // survives.
      "DELETE FROM group_memberships WHERE user_id LIKE 'u_e2e_%'",
      "DELETE FROM groups WHERE id NOT IN (SELECT DISTINCT group_id FROM group_memberships)",
      "DELETE FROM users WHERE id LIKE 'u_e2e_%'",
    ].join("; "),
  );
}

type SeededOperator = {
  readonly userId: string;
  readonly email: string;
  readonly cookie: string;
};

/**
 * Seeds a user, marks them as the bootstrap operator, mints a session, and
 * returns the signed cookie value the SPA (or `context.addCookies`) can use.
 */
export async function seedOperator(args: {
  readonly userId: string;
  readonly email: string;
  readonly name?: string;
}): Promise<SeededOperator> {
  const now = Date.now();
  const sessionId = `s_e2e_${args.userId}`;
  const sessionToken = `tk_e2e_${args.userId}_${now}`;

  // wrangler d1 execute runs `;`-joined statements as separate operations
  // — there is no transaction wrapping them. Order is FK-safe (user first,
  // dependents last); a partial failure mid-list will leave a half-seeded
  // instance, which the test's beforeEach truncate cleans up next run.
  executeSql(
    [
      `INSERT INTO users (id, email, email_verified, name, image, created_at, updated_at)
       VALUES ('${args.userId}', '${args.email}', 0, ${args.name ? `'${args.name}'` : "NULL"}, NULL, ${now}, ${now})`,
      `INSERT INTO instance_operators (user_id, granted_at, granted_by, revoked_at)
       VALUES ('${args.userId}', ${now}, '${args.userId}', NULL)`,
      `INSERT INTO approved_emails (email, added_by, added_at, note)
       VALUES ('${args.email}', '${args.userId}', ${now}, 'e2e seed')`,
      `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
       VALUES ('${sessionId}', '${args.userId}', '${sessionToken}', ${now + 86_400_000}, '127.0.0.1', 'playwright', ${now}, ${now})`,
    ].join("; "),
  );

  const signed = await signSessionToken(sessionToken);
  return { userId: args.userId, email: args.email, cookie: encodeURIComponent(signed) };
}

/**
 * Strips an operator row without touching the user or session — useful for
 * exercising the redirect-from-/admin path with a signed-in but non-operator
 * user.
 */
export function demoteToMember(userId: string): void {
  executeSql(`DELETE FROM instance_operators WHERE user_id = '${userId}'`);
}

/**
 * Attaches an authenticated session cookie to a Playwright BrowserContext for
 * both the Vite dev origin and the Worker origin. The Vite proxy carries the
 * SPA-origin cookie through to the Worker, but pages that talk to the Worker
 * directly (none today, but forward-compatible) still need the Worker-origin
 * cookie present.
 */
export async function attachSession(context: BrowserContext, cookie: string): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  await context.addCookies([
    {
      name: BETTER_AUTH_SESSION_COOKIE,
      value: cookie,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
      expires,
    },
  ]);
}
