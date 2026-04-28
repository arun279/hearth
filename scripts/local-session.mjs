#!/usr/bin/env node
/**
 * Mint a signed Better Auth session cookie against the local Miniflare D1.
 *
 * Thin CLI wrapper around `scripts/lib/auth-session.mjs`. Same code path
 * the e2e suite uses (`apps/web/e2e/auth.ts`), so a cookie minted here is
 * indistinguishable from one minted by an e2e test or by a real OAuth
 * sign-in (modulo the user id prefix).
 *
 * Usage:
 *   pnpm local-session                              # mint cookie for default operator
 *   pnpm local-session --email me@example.com       # mint cookie (creates if --seed)
 *   pnpm local-session --seed --email new@e.com     # seed user+operator+approved-email
 *   pnpm local-session --reset --email me@e.com     # drop user's groups+memberships+sessions
 *   pnpm local-session --json                       # machine-readable output
 *   pnpm local-session --cookie-only                # print just the cookie value (`pnpm -s ...`)
 */
import process from "node:process";
import {
  BETTER_AUTH_SESSION_COOKIE,
  findUserByEmail,
  isInstanceOperator,
  mintSessionCookie,
} from "./lib/auth-session.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const email = (args.email ?? "seed-operator@local.dev").trim().toLowerCase();
// Derive the default display name from the email local-part so multiple
// `--seed --email …` invocations produce distinguishable users in
// rendered rosters. The literal "Local Operator" still applies when the
// caller doesn't pass --email (the default seed identity).
const defaultName =
  email === "seed-operator@local.dev" ? "Local Operator" : (email.split("@")[0] ?? email);
const name = args.name ?? defaultName;
const userIdSlug = email.replace(/[^a-z0-9]/g, "_").slice(0, 40);
const userId = args.userId ?? `u_local_${userIdSlug}`;

if (!args.seed && !findUserByEmail(email)) {
  fail(`No user found for ${email}. Pass --seed to create one, or sign in via OAuth first.`);
}

let result;
try {
  result = await mintSessionCookie({
    userId,
    email,
    name,
    asOperator: args.seed,
    reset: args.reset,
    idPrefix: "s_local_",
  });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (args.cookieOnly) {
  process.stdout.write(result.cookie);
  process.exit(0);
}

if (args.json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        cookieName: BETTER_AUTH_SESSION_COOKIE,
        cookieValue: result.cookie,
        user: { id: result.userId, email },
        sessionToken: result.sessionToken,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const operator = isInstanceOperator(result.userId);
process.stdout.write(
  [
    `Signed in as ${email} (${result.userId})${operator ? " — instance operator" : ""}.`,
    "",
    "Use the cookie like:",
    `  curl -H 'cookie: ${BETTER_AUTH_SESSION_COOKIE}=${result.cookie}' http://localhost:5173/api/v1/me/context`,
    "",
    "Or in a Playwright BrowserContext:",
    `  await context.addCookies([{`,
    `    name: '${BETTER_AUTH_SESSION_COOKIE}',`,
    `    value: '${result.cookie}',`,
    `    domain: 'localhost',`,
    `    path: '/',`,
    `    sameSite: 'Lax',`,
    `  }]);`,
    "",
  ].join("\n"),
);

function parseArgs(argv) {
  const out = { seed: false, reset: false, json: false, cookieOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--seed") out.seed = true;
    else if (a === "--reset") out.reset = true;
    else if (a === "--json") out.json = true;
    else if (a === "--cookie-only") out.cookieOnly = true;
    else if (a === "--email") out.email = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--user-id") out.userId = argv[++i];
    else fail(`Unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: pnpm local-session [options]",
      "",
      "Options:",
      "  --email <addr>     Email to mint a session for (default seed-operator@local.dev)",
      "  --name <str>       Display name when --seed creates the user (default: 'Local Operator' for the seed identity, otherwise the email local-part)",
      "  --user-id <id>     Override the generated user id when seeding",
      "  --seed             Create the user, mark as operator, and approve the email",
      "  --reset            Delete the user's sessions, group memberships, and orphaned groups",
      "  --json             Emit a JSON blob instead of the human-readable hint",
      "  --cookie-only      Print just the cookie value (no newline) — pair with `pnpm -s`",
      "  --help, -h         Show this help",
      "",
    ].join("\n"),
  );
}

function fail(msg) {
  process.stderr.write(`local-session: ${msg}\n`);
  process.exit(1);
}
