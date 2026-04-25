import type { BrowserContext } from "@playwright/test";
import {
  BETTER_AUTH_SESSION_COOKIE,
  executeSql,
  mintSessionCookie,
} from "../../../scripts/lib/auth-session.mjs";

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
  executeSql([
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
  ]);
}

type SeededOperator = {
  readonly userId: string;
  readonly email: string;
  readonly cookie: string;
};

/**
 * Seeds a user, marks them as the bootstrap operator, mints a session, and
 * returns the signed cookie value the SPA (or `context.addCookies`) can use.
 *
 * Cookie/HMAC/SQL plumbing lives in `scripts/lib/auth-session.mjs` so a
 * cookie minted here is byte-identical to one minted by the dev CLI
 * (`scripts/local-session.mjs`) — one signing path, one place to update
 * if Better Auth's cookie shape ever changes.
 */
export async function seedOperator(args: {
  readonly userId: string;
  readonly email: string;
  readonly name?: string;
}): Promise<SeededOperator> {
  const { cookie } = await mintSessionCookie({
    userId: args.userId,
    email: args.email,
    name: args.name ?? "E2E Operator",
    asOperator: true,
    idPrefix: "s_e2e_",
  });
  return { userId: args.userId, email: args.email, cookie };
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
