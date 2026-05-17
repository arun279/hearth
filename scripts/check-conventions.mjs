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
  {
    // Length caps are exported from `@hearth/domain`
    // (`MAX_TITLE_LENGTH`, `MAX_LONG_TEXT_LENGTH`, …) so the server's
    // Zod schema and the SPA's `maxLength` attribute share one value.
    // An inline literal decouples them: when the cap moves on the
    // server, the SPA quietly truncates input below the new ceiling.
    name: "no-magic-maxlength-in-spa",
    regex: /\bmaxLength=\{\s*\d/,
    includePathPrefixes: ["apps/web/src/", "packages/ui/src/"],
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      "Reference the cap by name (`MAX_TITLE_LENGTH`, `MAX_LONG_TEXT_LENGTH`, …) from @hearth/domain instead of inlining a literal. Domain constants are the single source of truth — the SPA must not encode its own copy.",
  },
  {
    // Line numbers rot the moment a file is edited. A comment that
    // anchors to the statement's content (a verbatim SQL fragment, a
    // function name, a column + table pair) survives moves; one that
    // anchors to "line N" silently lies.
    name: "no-line-number-reference-in-comments",
    regex: /\bon line \d+(?:[–-]\d+)?\b/i,
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    includePathPrefixes: ["packages/", "apps/", "scripts/"],
    reason:
      "Comments must not reference code by line number — line numbers rot on the next edit. Quote the statement's distinctive content (e.g. a column name + table) so the anchor survives moves.",
  },
  {
    // Code comments that cite `AGENTS.md` / `CLAUDE.md` by name (often
    // with a § section reference) rot when the doc is reorganized or
    // sections are renamed. Repo docs are the single source of truth;
    // code comments should inline the rule's substance instead.
    name: "no-project-doc-citation-in-comments",
    regex: /\b(?:AGENTS|CLAUDE)\.md\b/,
    includePathPrefixes: ["packages/", "apps/"],
    excludePathSuffixes: [
      "scripts/check-conventions.mjs",
      // Test files that programmatically read AGENTS.md/CLAUDE.md to
      // enforce a paired-gate (e.g. the policy-purity drift check) are
      // pointing at the file as data, not citing it as documentation.
      // They are still subject to the spirit of this rule but can opt
      // in via `// allow-doc-ref: <reason>` immediately before the
      // line — none exist today.
    ],
    reason:
      "Code comments must not cite `AGENTS.md` / `CLAUDE.md` by name — section titles rot. Inline the rule's substance at the call site so the comment stands alone for a future reader.",
  },
  {
    // Internal PR/issue numbers ("PR #17 caught …") in code comments
    // anchor the code to git-history context that ages out fast — a
    // future reader without that history can't make sense of the
    // citation. Upstream-package issue refs (e.g. `better-auth#8949`)
    // are excluded via the `<package>#` prefix lookbehind: those
    // identify a specific external commit and stay stable.
    name: "no-internal-pr-reference-in-comments",
    regex: /(?<![\w-])PR #\d+\b/,
    includePathPrefixes: ["packages/", "apps/"],
    excludePathSuffixes: ["scripts/check-conventions.mjs"],
    reason:
      "Code comments must not reference internal PR numbers — the citation rots once history is forgotten. Inline the substantive lesson at the call site; the git log / PR description is the right home for the historical narrative.",
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
 * A file that calls `useQuery(` AND references `nextCursor` is shipping
 * half-finished pagination: a paginated endpoint's response includes
 * `nextCursor`, which `useQuery` cannot thread into the next page.
 * Such endpoints must be consumed by `useInfiniteQuery` so the cursor
 * round-trips and the user can fetch beyond page 1. Catches the M7
 * shape where the server returned `nextCursor` but the SPA used
 * `useQuery` and silently lost every result past the first page.
 *
 * @param {string[]} files
 * @returns {{ ref: string, location: string, line: string }[]}
 */
function findUseQueryWithCursorShape(files) {
  const USE_QUERY_PATTERN = /\buseQuery\s*\(/;
  const USE_INFINITE_PATTERN = /\buseInfiniteQuery\s*\(/;
  const NEXT_CURSOR_PATTERN = /\bnextCursor\b/;
  const SCRIPT_BASENAME = "scripts/check-conventions.mjs";
  /** @type {{ ref: string, location: string, line: string }[]} */
  const hits = [];

  for (const file of files) {
    if (file.endsWith(SCRIPT_BASENAME)) continue;
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (!file.startsWith("apps/web/")) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Strip comments before scanning so legitimate fix-later TODOs
    // (which may explain why `nextCursor` was deferred) don't read as
    // executable references to the field.
    const stripped = stripTsComments(text);
    if (!USE_QUERY_PATTERN.test(stripped)) continue;
    if (!NEXT_CURSOR_PATTERN.test(stripped)) continue;
    // If the file also contains useInfiniteQuery, the useQuery call may
    // be on a non-paginated endpoint sharing the file with a paginated
    // one. Fall through and assume the author handled both paths
    // explicitly — the alternative is a noisy false-positive on every
    // hook module that mixes query shapes.
    if (USE_INFINITE_PATTERN.test(stripped)) continue;

    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (USE_QUERY_PATTERN.test(line)) {
        hits.push({
          ref: "useQuery on paginated (nextCursor) endpoint",
          location: `${file}:${i + 1}`,
          line: line.trim(),
        });
        break;
      }
    }
  }
  return hits;
}

/**
 * Strip TypeScript block + line comments so source-text scans don't
 * misread comment prose as executable code. Approximate (no string-literal
 * awareness) but sufficient for the conventions checks that consume it.
 */
function stripTsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Every TS/TSX file that calls `useQuery(` or `useInfiniteQuery(` must
 * also reference `isError` somewhere in its source. Catches the failure
 * mode where a component reads `data` and `isLoading` but forgets
 * `isError`, so a server 5xx falls through to the empty-state branch
 * and the user is told their query had no results when actually the
 * request failed.
 *
 * The check is file-scoped rather than line-scoped because the
 * destructure may be split across lines, may name the query result
 * (e.g. `const search = useLibrarySearch(...); search.isError`), or
 * may pass the whole result to a child component. File-level "must
 * mention isError" is permissive enough to allow legitimate variations
 * but strict enough to catch the M7 bug shape.
 *
 * @param {string[]} files
 * @returns {{ ref: string, location: string, line: string }[]}
 */
function findQueryWithoutIsErrorHandling(files) {
  const QUERY_CALL_PATTERN = /\b(?:useQuery|useInfiniteQuery)\s*\(/;
  const IS_ERROR_PATTERN = /\bisError\b/;
  const SCRIPT_BASENAME = "scripts/check-conventions.mjs";
  /** @type {{ ref: string, location: string, line: string }[]} */
  const hits = [];

  for (const file of files) {
    if (file.endsWith(SCRIPT_BASENAME)) continue;
    if (!/\.(ts|tsx)$/.test(file)) continue;
    // Component / route files are where rendering happens — they're the
    // ones that must branch on isError to render an honest error state.
    // Hook-definition files (apps/web/src/hooks/) are pure data plumbing
    // that delegate isError to their consumers; the consumer is the
    // accountable file.
    const isRoute = file.startsWith("apps/web/src/routes/");
    const isComponent = file.startsWith("apps/web/src/components/");
    if (!isRoute && !isComponent) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    let firstCallLine = -1;
    let firstCallText = "";
    for (const [i, line] of lines.entries()) {
      if (QUERY_CALL_PATTERN.test(line)) {
        firstCallLine = i;
        firstCallText = line.trim();
        break;
      }
    }
    if (firstCallLine < 0) continue;
    if (IS_ERROR_PATTERN.test(text)) continue;
    hits.push({
      ref: "useQuery/useInfiniteQuery without isError",
      location: `${file}:${firstCallLine + 1}`,
      line: firstCallText,
    });
  }
  return hits;
}

/**
 * Every `check:<name>` reference in committed Markdown must resolve to
 * a script declared in the root `package.json`. Catches prose that
 * claims a `check:something` gate exists when no such script does —
 * the failure mode is documenting an "enforced" rule that is in fact
 * honor-system, which violates the project's real-gates principle.
 *
 * Only `check:`-prefixed names are matched; generic `pnpm <name>`
 * mentions are intentionally not flagged because pnpm forwards bare
 * binaries (`pnpm biome`, `pnpm wrangler`, …) to `node_modules/.bin`,
 * so a name not in `package.json#scripts` is not necessarily fictional.
 * Fenced code blocks and URL contexts are skipped same as the
 * markdown-reference check above.
 *
 * @param {string[]} files
 * @returns {{ ref: string, location: string, line: string }[]}
 */
function findFictionalCheckScripts(files) {
  /** @type {Set<string>} */
  const declared = new Set();
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    if (pkg && typeof pkg === "object" && pkg.scripts && typeof pkg.scripts === "object") {
      for (const name of Object.keys(pkg.scripts)) declared.add(name);
    }
  } catch {
    return [];
  }

  const CHECK_PATTERN = /(?<![\w-])(check:[a-z][a-z0-9:_-]*)\b/g;
  const URL_PATTERN = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;
  const FENCE_LINE_PATTERN = /^```/;

  const SCRIPT_BASENAME = "scripts/check-conventions.mjs";
  /** @type {{ ref: string, location: string, line: string }[]} */
  const hits = [];

  for (const file of files) {
    if (file.endsWith(SCRIPT_BASENAME)) continue;
    if (!/\.(md|mdx)$/.test(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let inFence = false;
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (FENCE_LINE_PATTERN.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const sanitized = line.replace(URL_PATTERN, "");

      CHECK_PATTERN.lastIndex = 0;
      let m = CHECK_PATTERN.exec(sanitized);
      while (m !== null) {
        const ref = m[1];
        if (ref && !declared.has(ref)) {
          hits.push({ ref, location: `${file}:${i + 1}`, line: line.trim() });
        }
        m = CHECK_PATTERN.exec(sanitized);
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

const useQueryCursorHits = findUseQueryWithCursorShape(files);
if (useQueryCursorHits.length > 0) {
  console.error(
    '\nConvention violation — useQuery on paginated endpoint (rule "no-paginated-usequery"):',
  );
  for (const h of useQueryCursorHits) console.error(`  ${h.location}: ${h.line}`);
  console.error(
    "  Why: a paginated endpoint's response includes `nextCursor`, which useQuery cannot thread into the next page. The cursor round-trip requires useInfiniteQuery + getNextPageParam. Using useQuery silently strands every result past the first page (the M7 ship-pattern). Switch the hook to useInfiniteQuery and surface a 'Load more' affordance, or drop the pagination metadata if v1 doesn't need it.\n",
  );
  fail = true;
}

const queryNoErrorHits = findQueryWithoutIsErrorHandling(files);
if (queryNoErrorHits.length > 0) {
  console.error(
    '\nConvention violation — query without isError handling (rule "react-query-must-handle-isError"):',
  );
  for (const h of queryNoErrorHits) console.error(`  ${h.location}: ${h.line}`);
  console.error(
    "  Why: a component using useQuery / useInfiniteQuery that reads data + isLoading but forgets isError will render its empty-state branch on a server 5xx — telling the user their query returned no matches when in fact the request failed (Nielsen #9: help users recognize, diagnose, and recover from errors). Reference isError somewhere in the file (the destructure, a banner branch, or a forwarded prop on a child).\n",
  );
  fail = true;
}

const fictionalScripts = findFictionalCheckScripts(files);
if (fictionalScripts.length > 0) {
  console.error(
    '\nConvention violation — fictional check script (rule "no-fictional-check-script"):',
  );
  for (const h of fictionalScripts) console.error(`  ${h.location}: ${h.line}    [${h.ref}]`);
  console.error(
    "  Why: prose that claims a `check:<name>` gate enforces a rule must point at a real script in the root package.json. Documenting an enforced rule that is in fact honor-system violates the project's real-gates principle (CLAUDE.md § Quality gates). Either wire the script or rephrase to drop the enforcement claim.\n",
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
