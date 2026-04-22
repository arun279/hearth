#!/usr/bin/env node
/**
 * Structural check for `apps/worker/.dev.vars.example`. Catches the class of
 * bug where an example value (e.g. `DISCORD_WEBHOOK_URL=""`) fails runtime
 * validation on first `pnpm dev`, blocking every request.
 *
 * Rules enforced:
 *   - Every uncommented `KEY=VALUE` line either has a non-empty value or the
 *     key is one that's declared optional in `@hearth/config` (SENTRY_DSN,
 *     DISCORD_WEBHOOK_URL).
 *   - Keys ending in `_URL` must start with `http://` or `https://` when non-empty.
 *   - The file contains every REQUIRED key listed below (catches accidental removal).
 *
 * Run via: pnpm check:env-example
 */
import { existsSync, readFileSync } from "node:fs";

const EXAMPLE_PATH = "apps/worker/.dev.vars.example";

const REQUIRED = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "KILLSWITCH_TOKEN",
  "HEARTH_BOOTSTRAP_OPERATOR_EMAIL",
];

const OPTIONAL = new Set(["SENTRY_DSN", "DISCORD_WEBHOOK_URL"]);

if (!existsSync(EXAMPLE_PATH)) {
  console.error(`check:env-example FAILED — ${EXAMPLE_PATH} not found`);
  process.exit(1);
}

const raw = readFileSync(EXAMPLE_PATH, "utf8");
const errors = [];
const seen = new Set();

for (const [i, line] of raw.split("\n").entries()) {
  const lineNo = i + 1;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;

  const m = trimmed.match(/^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/);
  if (!m) {
    errors.push(`line ${lineNo}: could not parse as KEY=VALUE — "${trimmed}"`);
    continue;
  }
  const key = m[1];
  const value = m[2] ?? m[3] ?? "";
  seen.add(key);

  if (!value && !OPTIONAL.has(key)) {
    errors.push(`line ${lineNo}: ${key}="" — non-optional key has empty example value`);
    continue;
  }

  // If a URL key is present with a non-empty value, it must look like a URL.
  if (key.endsWith("_URL") && value && !/^https?:\/\//.test(value)) {
    errors.push(
      `line ${lineNo}: ${key}="${value}" — URL key must start with http:// or https:// when set`,
    );
  }
}

for (const key of REQUIRED) {
  if (!seen.has(key)) {
    errors.push(`required key ${key} is not documented in ${EXAMPLE_PATH}`);
  }
}

if (errors.length > 0) {
  console.error(`check:env-example FAILED — ${EXAMPLE_PATH} has issues:`);
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}
console.log(`check:env-example OK (${REQUIRED.length} required keys documented)`);
