#!/usr/bin/env node
/**
 * Local mirror of the GitHub `actions/dependency-review-action` gate.
 *
 * Mirrors the action's behaviour exactly: scans only the packages
 * INTRODUCED by the current branch (vs `origin/main`), against the
 * same allow-list + per-package carve-out the workflow uses. The
 * single source of truth is `.github/dependency-review-config.json`
 * — both this script and the workflow (via the action's
 * `config-file:` input) read from it, so drift between local and
 * remote is structurally impossible.
 *
 * Run via: `pnpm check:licenses`. Wired into `pnpm check` and the
 * lefthook pre-push pool so a license violation trips on the laptop
 * before the push completes.
 *
 * Behaviour matches the action:
 *   - Full-tree scans are wrong. Pre-existing packages are
 *     grandfathered into main and the action only flags diff-added
 *     ones (the action reads the base-vs-head dependency graph).
 *   - SPDX `X OR Y` expressions are accepted if ANY clause matches
 *     the allow-list. The action follows the SPDX standard; we
 *     follow it here too.
 *   - Per-package carve-outs are matched on `<name>@<version>`. The
 *     workflow stores them as PURLs (`pkg:npm/<name>@<version>`); the
 *     translation handles the `%40` URL-encoding of the npm scope.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CONFIG_PATH = resolve(REPO_ROOT, ".github", "dependency-review-config.json");

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const allowedLicenses = new Set(config["allow-licenses"]);
const allowedDependencies = new Set(
  config["allow-dependencies-licenses"].map((purl) => {
    const stripped = purl.startsWith("pkg:npm/") ? purl.slice("pkg:npm/".length) : purl;
    return decodeURIComponent(stripped);
  }),
);

/**
 * Names + versions of packages introduced by the current branch
 * relative to `origin/main`. Returns `null` to signal the caller
 * should fall back to a full-tree scan (first-time setup before
 * `origin/main` is available).
 */
function diffAddedPackages() {
  let baseLockfile = "";
  try {
    baseLockfile = run("git", ["show", "origin/main:pnpm-lock.yaml"]);
  } catch {
    return null;
  }
  const headLockfile = readFileSync(resolve(REPO_ROOT, "pnpm-lock.yaml"), "utf8");
  const basePkgs = extractPackages(baseLockfile);
  const headPkgs = extractPackages(headLockfile);
  const added = [];
  for (const pkg of headPkgs) {
    if (!basePkgs.has(pkg)) added.push(pkg);
  }
  return added;
}

// pnpm-lock.yaml v9 lists every package under top-level `packages:`
// keyed by `'<name>@<version>':` (single-quoted, two-space-indented).
// Stop at the next top-level key. The grep is line-oriented so YAML
// nesting elsewhere is irrelevant.
function extractPackages(lockfileText) {
  const out = new Set();
  let inPackagesBlock = false;
  for (const line of lockfileText.split("\n")) {
    if (line.startsWith("packages:")) {
      inPackagesBlock = true;
      continue;
    }
    if (inPackagesBlock && /^[a-zA-Z]/.test(line)) {
      // Hit the next top-level key; packages section ended.
      inPackagesBlock = false;
    }
    if (!inPackagesBlock) continue;
    // pnpm-lock v9 quotes scoped names (`'@scope/name@version':`) and
    // peer-resolved variants, but NOT plain names (`name@version:`).
    // Match both shapes.
    const quoted = line.match(/^ {2}'([^']+@[^']+)':\s*$/);
    if (quoted) {
      out.add(quoted[1]);
      continue;
    }
    const bare = line.match(/^ {2}([a-zA-Z0-9._-]+@[^\s:(]+):\s*$/);
    if (bare) out.add(bare[1]);
  }
  return out;
}

function run(cmd, args) {
  return execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const added = diffAddedPackages();
if (added !== null && added.length === 0) {
  console.log("check:licenses OK (no dependency changes vs origin/main)");
  process.exit(0);
}

// `pnpm licenses list --json` keys by license string; values are
// arrays of `{ name, versions, license, ... }` package metadata.
const stdout = execFileSync("pnpm", ["-s", "licenses", "list", "--json"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const licenses = JSON.parse(stdout);

const addedSet = added === null ? null : new Set(added);
const violations = [];
let scanned = 0;

for (const [licenseExpr, packages] of Object.entries(licenses)) {
  if (!Array.isArray(packages)) continue;
  for (const pkg of packages) {
    const name = String(pkg.name ?? "");
    const versions = Array.isArray(pkg.versions) ? pkg.versions.map(String) : [];
    for (const version of versions) {
      const id = `${name}@${version}`;
      if (addedSet !== null && !addedSet.has(id)) continue;
      scanned += 1;
      if (allowedDependencies.has(id)) continue;
      if (licenseExpressionAllowed(licenseExpr, allowedLicenses)) continue;
      violations.push({ id, license: licenseExpr });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\ncheck:licenses — ${violations.length} package${violations.length === 1 ? "" : "s"} with disallowed license(s):\n`,
  );
  for (const v of violations) console.error(`  ${v.id}   license: ${v.license}`);
  console.error(
    `\nAllowed licenses: ${[...allowedLicenses].sort().join(", ")}` +
      `\nPer-package carve-outs: ${[...allowedDependencies].sort().join(", ") || "(none)"}` +
      "\n\nResolution paths (ranked):" +
      "\n  1. Find a permissive-licensed alternative package — preferred." +
      "\n  2. Add a narrow carve-out to .github/dependency-review-config.json," +
      "\n     pinned to the exact <name>@<version>, with a tripwires.md entry" +
      "\n     documenting the trigger to revisit." +
      "\n  3. Promote the license to allow-licenses ONLY with maintainer approval." +
      "\n     Promoting silences the signal across the whole tree.\n",
  );
  process.exit(1);
}

const scope = added === null ? "full tree" : `${scanned} new package(s) vs origin/main`;
console.log(`check:licenses OK (${scope})`);

/**
 * SPDX `X OR Y` / parenthesized expressions are allowed if ANY
 * clause matches the allow-list. AND-expressions require all
 * clauses to match — but real-world npm packages rarely use AND
 * for license expressions (the SPDX usage is overwhelmingly OR for
 * dual-licensed packages). Conservative path: split on `OR` and
 * accept on any-match.
 */
function licenseExpressionAllowed(expr, allowed) {
  if (allowed.has(expr)) return true;
  // Strip outer parens; split on OR (case-insensitive).
  const stripped = expr.replace(/^\(/, "").replace(/\)$/, "");
  if (!/\bOR\b/i.test(stripped)) return false;
  const parts = stripped
    .split(/\s+OR\s+/i)
    .map((s) => s.replace(/^\(/, "").replace(/\)$/, "").trim());
  return parts.some((part) => allowed.has(part));
}
