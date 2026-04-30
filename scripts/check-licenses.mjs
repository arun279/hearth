#!/usr/bin/env node
/**
 * Local mirror of the GitHub `actions/dependency-review-action` gate,
 * plus a self-cleaning gate for the carve-out list itself.
 *
 * Mirrors the action's behaviour for new-package licensing: scans only
 * the packages INTRODUCED by the current branch (vs `origin/main`),
 * against the same allow-list + per-package carve-out the workflow
 * uses. The single source of truth is
 * `.github/dependency-review-config.json` — both this script and the
 * workflow (via the action's `config-file:` input) read from it, so
 * drift between local and remote is structurally impossible.
 *
 * The dead-carve-out gate runs on the FULL lockfile every time and
 * fails if any `allow-dependencies-licenses` entry is no longer
 * load-bearing — the package has left the tree, OR its license now
 * satisfies the allow-list on its own (e.g. an SPDX `(WTFPL OR MIT)`
 * expression once the action gained OR-clause support). Catches
 * silenced-signal carve-outs that would otherwise rot in the config
 * forever — a class previously left to manual tripwire review.
 *
 * Run via: `pnpm check:licenses`. Wired into `pnpm check` and the
 * lefthook pre-push pool so a license violation trips on the laptop
 * before the push completes.
 *
 * Behaviour matches the action:
 *   - Full-tree scans are wrong for the new-package check. Pre-
 *     existing packages are grandfathered into main and the action
 *     only flags diff-added ones (the action reads the base-vs-head
 *     dependency graph).
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

// `pnpm licenses list --json` keys by license string; values are
// arrays of `{ name, versions, license, ... }` package metadata.
// We always read the full tree (the dead-carve-out gate needs the
// whole lockfile); the new-package gate filters to the diff below.
const stdout = execFileSync("pnpm", ["-s", "licenses", "list", "--json"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const licenses = JSON.parse(stdout);

// Build a fast (id → licenseExpr) lookup once, then drive both gates
// off it. Preserves the source-of-truth shape (license-keyed) while
// letting the carve-out gate look up by package id.
const licenseById = new Map();
for (const [licenseExpr, packages] of Object.entries(licenses)) {
  if (!Array.isArray(packages)) continue;
  for (const pkg of packages) {
    const name = String(pkg.name ?? "");
    const versions = Array.isArray(pkg.versions) ? pkg.versions.map(String) : [];
    for (const version of versions) {
      licenseById.set(`${name}@${version}`, licenseExpr);
    }
  }
}

// ── Dead-carve-out gate ────────────────────────────────────────────
// Each entry in `allow-dependencies-licenses` must be load-bearing:
// the package must be in the tree AND its license must NOT satisfy
// the allow-list on its own. Anything else is silenced signal that
// would mask a future genuine violation.
const deadCarveOuts = [];
for (const id of allowedDependencies) {
  const licenseExpr = licenseById.get(id);
  if (licenseExpr === undefined) {
    deadCarveOuts.push({ id, reason: "package not present in the lockfile" });
    continue;
  }
  if (licenseExpressionAllowed(licenseExpr, allowedLicenses)) {
    deadCarveOuts.push({
      id,
      reason: `license '${licenseExpr}' is already satisfied by the allow-list`,
    });
  }
}

if (deadCarveOuts.length > 0) {
  console.error(
    `\ncheck:licenses — ${deadCarveOuts.length} dead carve-out${deadCarveOuts.length === 1 ? "" : "s"} in allow-dependencies-licenses:\n`,
  );
  for (const c of deadCarveOuts) console.error(`  ${c.id}   ${c.reason}`);
  console.error(
    "\nDead carve-outs are silenced signal — remove them from" +
      " .github/dependency-review-config.json (and any tripwires.md entry" +
      " that documents them). A carve-out that covers a package the" +
      " allow-list already accepts will hide a genuine future violation" +
      " on the same line.\n",
  );
  process.exit(1);
}

// ── New-package gate ───────────────────────────────────────────────
const added = diffAddedPackages();
if (added !== null && added.length === 0) {
  console.log("check:licenses OK (no dependency changes vs origin/main)");
  process.exit(0);
}

const addedSet = added === null ? null : new Set(added);
const violations = [];
let scanned = 0;

for (const [id, licenseExpr] of licenseById) {
  if (addedSet !== null && !addedSet.has(id)) continue;
  scanned += 1;
  if (allowedDependencies.has(id)) continue;
  if (licenseExpressionAllowed(licenseExpr, allowedLicenses)) continue;
  violations.push({ id, license: licenseExpr });
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
