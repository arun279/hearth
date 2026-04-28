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
      "packages/core/src/use-cases/_lib/load-viewable-group.ts",
      // Invitation preview is unauthenticated by design — the token is the
      // credential, the actor has no membership yet, and the response
      // contract intentionally exposes group + instance name to the
      // token holder. canViewGroup would universally deny here, so
      // loadViewableGroup is the wrong tool. Documented carve-out.
      "packages/core/src/use-cases/preview-invitation.ts",
    ],
    reason:
      "Use cases must load Study Groups via loadViewableGroup() — direct repository-byId calls skip canViewGroup and create a 403/404 enumeration oracle (AGENTS.md § Viewability before authorization).",
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
 * Every markdown filename mentioned in committed text must resolve to a
 * markdown file committed to this repo, matched by basename or by
 * repo-relative path. The allowlist is built from `git ls-files` on
 * every run: committing a new doc authorizes references to it
 * automatically; references to uncommitted docs are flagged.
 *
 * URL contexts (`https://…/foo.md`) and fenced code blocks inside
 * markdown (where glob-shaped patterns like `**\/*.md` appear in
 * examples) are skipped.
 *
 * @param {string[]} files
 * @returns {{ ref: string, location: string, line: string }[]}
 */
function findUncommittedMarkdownReferences(files) {
  const committedMd = new Set();
  for (const f of files) {
    if (!/\.(md|mdx)$/.test(f)) continue;
    committedMd.add(f);
    const base = f.split("/").pop();
    if (base) committedMd.add(base);
  }

  const URL_PATTERN = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;
  const FENCE_LINE_PATTERN = /^```/;
  const MD_REFERENCE_PATTERN = /(?<![\w-])([A-Za-z0-9][\w.-]*\.(?:md|mdx))\b/g;

  const SCRIPT_BASENAME = "scripts/check-conventions.mjs";
  /** @type {{ ref: string, location: string, line: string }[]} */
  const hits = [];

  for (const file of files) {
    if (file.endsWith(SCRIPT_BASENAME)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const isMarkdown = /\.(md|mdx)$/.test(file);
    let inFence = false;
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (isMarkdown && FENCE_LINE_PATTERN.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const sanitized = line.replace(URL_PATTERN, "");
      MD_REFERENCE_PATTERN.lastIndex = 0;
      let m = MD_REFERENCE_PATTERN.exec(sanitized);
      while (m !== null) {
        const ref = m[1];
        const base = ref.split("/").pop();
        if (!(committedMd.has(ref) || (base && committedMd.has(base)))) {
          hits.push({ ref, location: `${file}:${i + 1}`, line: line.trim() });
        }
        m = MD_REFERENCE_PATTERN.exec(sanitized);
      }
    }
  }
  return hits;
}

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

// Source / config / doc extensions we scan for convention violations.
// `.example` covers env-file templates (`.dev.vars.example`); `.txt` /
// `.toml` / `.cjs` cover config that isn't otherwise picked up. The
// allowlist approach keeps the scan deterministic and excludes binary
// payloads (lock files, images, fonts) without per-extension carve-outs.
const SCANNED_EXTENSIONS =
  /\.(ts|tsx|mjs|cjs|js|json|jsonc|yml|yaml|sh|md|mdx|toml|txt|example|template)$/;
const SCANNED_EXACT_NAMES = new Set(["CODEOWNERS"]);

function shouldScan(file) {
  if (SCANNED_EXTENSIONS.test(file)) return true;
  const base = file.split("/").pop();
  return base !== undefined && SCANNED_EXACT_NAMES.has(base);
}

function listFiles() {
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout.split("\n").filter(Boolean).filter(shouldScan);
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
    else if (entry.isFile() && shouldScan(entry.name)) out.push(full);
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

const uncommittedMdRefs = findUncommittedMarkdownReferences(files);
if (uncommittedMdRefs.length > 0) {
  console.error(
    '\nConvention violation — uncommitted markdown reference (rule "no-uncommitted-md-reference"):',
  );
  for (const h of uncommittedMdRefs) console.error(`  ${h.location}: ${h.line}    [${h.ref}]`);
  console.error(
    "  Why: every markdown filename mentioned in committed code must resolve to a doc actually committed to this repo. Pointing at a maintainer-only doc that lives outside the repo (or a doc that hasn't been committed yet) leaves the reference dangling for anyone cloning. Inline the rationale, commit the doc, or rename the mention away.\n",
  );
  fail = true;
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
