#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Project convention greps. Catches banned patterns that wouldn't be
 * caught by typecheck / biome / dep-cruiser.
 *
 * Rules are specified as regexes over file content so this script doesn't
 * itself contain the literal banned tokens. That lets a single rule match
 * a family of shapes (e.g., any numbered-ADR reference) and keeps the
 * script exempt from its own rules by design (not by exclusion).
 *
 * Run via: pnpm check:conventions
 */
import { readdirSync, readFileSync, statSync } from "node:fs";

/**
 * @typedef {{
 *   name: string,
 *   regex: RegExp,
 *   exceptRegex?: RegExp,
 *   includePathPrefixes?: string[],
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
      "docs/deployment-runbook.md",
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
  {
    // Matches paths under the maintainer's private workspace tree.
    name: "no-workspace-prefix",
    regex: /\b_prd_workspace\b/,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      "Private planning workspace paths must not appear in committed code — keep reasoning self-contained.",
  },
  {
    // Matches `createSchemaFactory({ ... coerce: ... })` calls on drizzle-zod.
    // drizzle-team/drizzle-orm#5659: `z.coerce.X()` returns input type
    // `unknown` under Zod 4, which breaks downstream form-resolver type
    // inference. Workaround: do coercion at the API boundary with an explicit
    // input-type generic, never inside the column→schema factory.
    name: "no-drizzle-zod-coerce",
    regex: /createSchemaFactory\s*\([^)]*\bcoerce\s*:/,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      "drizzle-zod + Zod 4 `coerce: true` regression (drizzle-orm#5659) makes generated schemas' input type `unknown`. Coerce at the API boundary instead.",
  },
  {
    // Matches milestone-id filenames shaped like `M0-spine.md`, `M12-visibility.md`.
    name: "no-milestone-filename",
    regex: /\bM\d{1,2}-[\w-]+\.(md|mdx)\b/,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      "Maintainer milestone-plan filenames must not appear in committed code — reference the committed runbook or inline the reason.",
  },
  {
    // Carve-out lookaheads require `download` / `data-external-nav` to be
    // followed by an HTML-attribute boundary so class names like
    // `icon-download` don't falsely exempt a real violation.
    name: "no-spa-anchor-to-api",
    regex: /<a\s+[^>]*href="\/api\//,
    exceptRegex: /\b(?:download|data-external-nav)(?=[\s=>])|\btarget=/,
    includePathPrefixes: ["apps/web/src/", "packages/ui/src/"],
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      '`<a href>` is GET-only. Use hc<AppType> for /api/v1/* and authClient for /api/auth/*. For legitimate GET uses (file download, external nav), add `download`, `target="_blank"`, or `data-external-nav`.',
  },
  {
    name: "no-direct-group-byid-in-use-cases",
    regex: /\bgroups\.byId\(/,
    includePathPrefixes: ["packages/core/src/use-cases/"],
    excludePathSuffixes: [
      "scripts/check-conventions.mjs",
      "packages/core/src/use-cases/_lib/load-viewable-group.ts",
      // Invitation preview is unauthenticated by design — the token is the
      // credential, the actor has no membership yet, and the response
      // contract intentionally exposes group + instance name to the
      // token holder. canViewGroup would universally deny here, so
      // loadViewableGroup is the wrong tool. Documented carve-out.
      "packages/core/src/use-cases/preview-invitation.ts",
    ],
    reason:
      "Use cases must load Study Groups via loadViewableGroup() — direct `groups.byId(` skips canViewGroup and creates a 403/404 enumeration oracle (AGENTS.md § Viewability before authorization).",
  },
  {
    name: "no-bespoke-dialog-role",
    regex: /role=["']dialog["']/,
    includePathPrefixes: ["packages/", "apps/"],
    excludePathSuffixes: [
      "scripts/check-conventions.mjs",
      "packages/ui/src/modal.tsx",
      "packages/ui/src/drawer.tsx",
      "packages/ui/src/dialog-keyboard.ts",
    ],
    reason:
      "role='dialog' must come from the @hearth/ui Modal or Drawer primitive. Bespoke dialogs miss the stack-aware ESC handling, focus trap, inert-when-not-topmost, and visible close affordance enforced by useDialogPanel.",
  },
];

/**
 * Files that MUST contain a specific pattern. Complement to the
 * forbidden-pattern rules above — for load-bearing configuration where
 * absence of a directive is the bug.
 *
 * @type {Array<{ path: string, regex: RegExp, reason: string }>}
 */
const REQUIRED_CONTENT = [
  {
    path: "packages/ui/src/styles.css",
    regex: /@source\s+"\.\//,
    reason:
      'UI package CSS must contain a self-referential `@source "./..."` so consumers don\'t hard-code scan paths back into this package.',
  },
];

/**
 * Hard line caps on documentation that agents discover on entry. AGENTS.md
 * in particular is loaded as context for LLM-backed agents; keeping it
 * under 200 lines forces the file to link out rather than duplicate.
 *
 * @type {Array<{ path: string, max: number }>}
 */
const DOCS_SIZE_CAPS = [
  { path: "AGENTS.md", max: 200 },
  { path: "CLAUDE.md", max: 100 },
];

function listFiles() {
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
    if (rule.includePathPrefixes && !rule.includePathPrefixes.some((p) => file.startsWith(p)))
      continue;
    if (rule.excludePathSuffixes?.some((s) => file.endsWith(s) || file.includes(s))) continue;
    try {
      statSync(file);
    } catch {
      continue;
    }
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (rule.regex.test(line) && !rule.exceptRegex?.test(line)) {
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

for (const req of REQUIRED_CONTENT) {
  let text;
  try {
    text = readFileSync(req.path, "utf8");
  } catch {
    console.error(`\nRequired-content violation — ${req.path} is missing.`);
    console.error(`  Why: ${req.reason}\n`);
    fail = true;
    continue;
  }
  if (!req.regex.test(text)) {
    console.error(
      `\nRequired-content violation — ${req.path} does not contain required pattern ${req.regex}.`,
    );
    console.error(`  Why: ${req.reason}\n`);
    fail = true;
  }
}

for (const cap of DOCS_SIZE_CAPS) {
  let text;
  try {
    text = readFileSync(cap.path, "utf8");
  } catch {
    continue;
  }
  const lineCount = text.split("\n").length;
  if (lineCount > cap.max) {
    console.error(
      `\nDocs size-cap violation — ${cap.path} has ${lineCount} lines (max ${cap.max}).`,
    );
    console.error(
      `  Why: agent-entry docs are loaded into LLM context; keeping them short forces link-out over duplication.\n`,
    );
    fail = true;
  }
}

if (fail) {
  console.error("check:conventions FAILED. See matches above.");
  process.exit(1);
}
console.log("check:conventions OK");
