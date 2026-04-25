/**
 * Type declarations for `auth-session.mjs`. Source-of-truth implementation
 * lives in the .mjs (kept in plain JS so the local-session CLI runs under
 * `node` with no transpilation step). This file is the contract TypeScript
 * consumers (`apps/web/e2e/auth.ts`) compile against.
 */

export const BETTER_AUTH_SESSION_COOKIE: "better-auth.session_token";

/**
 * Escape a value for inclusion in a SQLite single-quoted string literal.
 */
export function q(s: unknown): string;

/**
 * Read a key=value line from `apps/worker/.dev.vars`. Strips surrounding
 * single or double quotes and trims whitespace.
 */
export function readDevVar(key: string, devVarsPath?: string): string;

/**
 * Run one or more SQL statements against the local Miniflare D1 via
 * `wrangler d1 execute --local`. An array is joined with `;` so a single
 * subprocess handles the batch.
 */
export function executeSql(sql: string | readonly string[]): void;

/** Look up a user row by canonical email. Returns null if not present. */
export function findUserByEmail(email: string): { id: string } | null;

/** True iff there's a non-revoked instance_operators row for `userId`. */
export function isInstanceOperator(userId: string): boolean;

/**
 * Sign a session token with HMAC-SHA256(secret, token). Pure function:
 * same inputs → same output.
 */
export function signSessionToken(token: string, secret: string): Promise<string>;

/**
 * Ensure a user exists, mint a fresh session row, and return the signed
 * cookie value (URL-encoded, ready to drop into `Set-Cookie` or
 * Playwright `context.addCookies`).
 */
export function mintSessionCookie(args: {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly asOperator?: boolean;
  readonly reset?: boolean;
  readonly idPrefix?: string;
}): Promise<{ cookie: string; sessionToken: string; userId: string }>;
