import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_PROBLEM_CODES } from "./problem.ts";

/**
 * Source-text scan that pairs the server-side reason emitters with the
 * SPA-side `policyDenialMessages` map.
 *
 * Why this lives here: `problemMessage()` falls back to `problem.detail`
 * when a code is absent, which silently leaks internal phrasing (e.g.
 * "displayOrder references unknown Part ${id}") into the toast. The
 * compile-time typing on `policyDeny()` catches new policy-denial codes
 * at the call site, but `throw new DomainError(<code>, <msg>, <reason>)`
 * calls can still emit a wire code without a matching SPA message. The
 * scan walks every package that constructs a `DomainError` and asserts
 * each emitted code literal has an entry in `KNOWN_PROBLEM_CODES`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

// Every package whose source files can construct a `DomainError` or
// call `policyDeny()` belongs here — anything that emits a reason
// code which `problemMessage()` may then look up. Adding a new
// emitter package without extending this tuple lets emitted codes
// slip past the gate silently.
const SCAN_ROOTS: readonly string[] = [
  resolve(REPO_ROOT, "packages", "domain", "src"),
  resolve(REPO_ROOT, "packages", "core", "src"),
  resolve(REPO_ROOT, "packages", "auth", "src"),
  resolve(REPO_ROOT, "packages", "api", "src"),
];

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walkTs(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

const POLICY_DENY_RE = /policyDeny\(\s*"([a-z_]+)"/g;
// `,?\s*\)` lets the regex consume the trailing comma biome inserts
// before the closing paren on multi-line calls — without it, the
// dominant `new DomainError(\n  "CODE",\n  "msg",\n  "reason",\n)`
// shape escapes the scan.
const DOMAIN_ERROR_RE = /new\s+DomainError\([^)]*?,\s*"([a-z_]+)"\s*,?\s*\)/gs;
const FAIL_HELPER_RE = /\bfail\(\s*"([a-z_]+)"/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function collectCodes(): { readonly emitted: ReadonlySet<string>; readonly visited: number } {
  const codes = new Set<string>();
  let visited = 0;
  for (const root of SCAN_ROOTS) {
    for (const file of walkTs(root)) {
      const src = stripComments(readFileSync(file, "utf8"));
      visited++;
      for (const re of [POLICY_DENY_RE, DOMAIN_ERROR_RE, FAIL_HELPER_RE]) {
        for (const match of src.matchAll(re)) {
          const code = match[1];
          if (code !== undefined) codes.add(code);
        }
      }
    }
  }
  return { emitted: codes, visited };
}

const ALLOWED_INTERNAL_CODES = new Set<string>([
  // Surfaces that are server-internal — the API layer maps them to
  // generic copy via `problem.detail`, never to a user toast.
  "not_found",
]);

describe("problem code coverage", () => {
  const { emitted, visited } = collectCodes();
  const known = new Set<string>(KNOWN_PROBLEM_CODES);

  it("walked at least one source file", () => {
    expect(visited).toBeGreaterThan(0);
  });

  it("every emitted domain reason code has a user-facing SPA message", () => {
    const missing: string[] = [];
    for (const code of emitted) {
      if (ALLOWED_INTERNAL_CODES.has(code)) continue;
      if (!known.has(code)) missing.push(code);
    }
    expect(missing, `missing SPA copy for ${missing.join(", ")}`).toEqual([]);
  });
});
