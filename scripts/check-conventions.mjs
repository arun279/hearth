#!/usr/bin/env node
/**
 * Project convention greps. Catches banned patterns that wouldn't be
 * caught by typecheck / biome / dep-cruiser.
 *
 * Rules are specified as regexes over file content so this script doesn't
 * itself contain the literal banned tokens. That also lets a single rule
 * match a family of shapes (e.g., any numbered-ADR reference).
 *
 * Run via: pnpm check:conventions
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";

/**
 * @typedef {{
 *   name: string,
 *   regex: RegExp,
 *   excludePathSuffixes?: string[],
 *   reason: string,
 * }} Rule
 */

/** @type {Rule[]} */
const rules = [
  {
    name: "no-wrangler-deploy",
    regex: /\bwrangler\s+deploy\b/,
    excludePathSuffixes: [
      "scripts/check-conventions.mjs",
      ".github/workflows/",
      "CLAUDE.md",
      "AGENTS.md",
    ],
    reason:
      "Canonical deploy is `wrangler versions upload` + `wrangler versions deploy --yes` — versioned deploys give atomic traffic flips and one-command rollback.",
  },
  {
    name: "no-drizzle-introspect",
    regex: /\bdrizzle-kit\s+(introspect|pull)\b/,
    excludePathSuffixes: ["scripts/check-conventions.mjs", "CLAUDE.md", "AGENTS.md"],
    reason: "Schema is hand-split; introspect/pull would thrash the layout.",
  },
  {
    // Matches any `ADR NNNN` or `ADR-NNNN` reference — planning docs live
    // outside this repo; pointing at them from committed code breaks for
    // anyone cloning.
    name: "no-numbered-adr-reference",
    regex: /\bADR[- ]\d{3,4}\b/,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      "Planning-doc references (numbered architecture decisions) must not appear in committed code.",
  },
  {
    // Matches any relative path pointing OUT of this repo into a sibling
    // `docs/` directory (i.e., `../docs/...` or `../../docs/...`).
    name: "no-sibling-docs-path",
    regex: /\.\.\/(\.\.\/)?docs\//,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      "Relative paths pointing at maintainer-only planning docs outside the repo must not appear in committed code.",
  },
  {
    // Matches filenames of the maintainer-only planning docs by SHAPE
    // (e.g., `<name>-claude.md`, `<name>-claude.ts`). Without naming them
    // explicitly here, so this script is also clean.
    name: "no-planning-doc-filename",
    regex: /\b[\w-]*-claude\.(md|mdx|ts|mjs)\b/,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason: "Planning-doc filenames must not appear in committed code.",
  },
  {
    // Matches `docs/adr/NNNN...` shape paths.
    name: "no-adr-path",
    regex: /\bdocs\/adr\/\d{3,4}/,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason: "Planning-doc ADR paths must not appear in committed code.",
  },
];

function listFiles() {
  // Use git ls-files so the check only looks at tracked files (plus files
  // that would be tracked — no node_modules, no build output).
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .filter(
        (f) => /\.(ts|tsx|mjs|cjs|js|json|jsonc|yml|yaml|sh|md|mdx)$/.test(f) || f === "CODEOWNERS",
      );
  }
  // Fallback for first-time runs before `git add`: walk the tree directly.
  return walk(".");
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  const skip = new Set(["node_modules", ".turbo", ".wrangler", ".git", "dist", ".ci"]);
  const { readdirSync } = require("node:fs");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(full));
    else if (
      entry.isFile() &&
      (/\.(ts|tsx|mjs|cjs|js|json|jsonc|yml|yaml|sh|md|mdx)$/.test(entry.name) ||
        entry.name === "CODEOWNERS")
    )
      out.push(full);
  }
  return out;
}

const files = listFiles();
let fail = false;

for (const rule of rules) {
  const hits = [];
  for (const file of files) {
    if (rule.excludePathSuffixes?.some((s) => file.endsWith(s) || file.includes(s))) continue;
    try {
      statSync(file); // skip stale listings
    } catch {
      continue;
    }
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (rule.regex.test(line)) {
        hits.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  if (hits.length > 0) {
    console.error(`\nConvention violation — rule "${rule.name}" (regex ${rule.regex}):`);
    for (const h of hits) console.error(`  ${h}`);
    console.error(`  Why: ${rule.reason}\n`);
    fail = true;
  }
}

// execFileSync is imported so the script can grow to shell-out checks later;
// silence the unused-import warning.
void execFileSync;
void relative;

if (fail) {
  console.error("check:conventions FAILED. See matches above.");
  process.exit(1);
}
console.log("check:conventions OK");
