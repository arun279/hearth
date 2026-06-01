/**
 * Single source of truth for the "SPA-pure" directories under
 * `packages/domain/src/`. These dirs hold modules the SPA imports for
 * client-side capability + visibility computation; they must stay
 * free of Node globals, async, `Date.now()`, `crypto.*`, and dynamic
 * imports.
 *
 * Three gates consume this file:
 *
 *   1. `.dependency-cruiser.cjs` — `policy-purity-no-node-globals` rule.
 *      Catches Node-built-in IMPORTS at the dep-graph level.
 *
 *   2. `packages/domain/test/policy-purity.test.ts` — Vitest source-text
 *      scan. Catches inline EXPRESSIONS (`Date.now()`, `crypto.*`) that
 *      dep-cruiser cannot see.
 *
 *   3. `lefthook.yml` — the `pre-push.policy-purity` accelerator runs the
 *      source-text scan eagerly when a file under one of these dirs is
 *      touched. Its `glob` is a static YAML string (lefthook cannot
 *      `require()` JS), so it is hand-mirrored from `lefthookGlob` below
 *      and pinned against drift by the same vitest assertion that pins the
 *      dep-cruiser regex.
 *
 * All three must scope identically. Editing the regex on the dep-cruiser
 * side directly is structurally impossible: it builds the regex from
 * the array exported here. The lefthook glob and the dep-cruiser regex
 * are both compared against the SoT-derived value by a vitest drift
 * assertion (in the same file as the source-text scan), so a stale
 * hand-edit on either side fails `pnpm test`.
 *
 * To add a new SPA-pure directory: append to `DIRS`, run the test, and
 * sync the failing `lefthook.yml` glob to the value the assertion prints.
 */
const DIRS = ["policy", "visibility", "library", "parts", "record"];

module.exports = {
  DIRS,
  /** Regex string for dep-cruiser's `from.path`. */
  depCruiserFromPath: `^packages/domain/src/(${DIRS.join("|")})/`,
  /** Path strings (relative to packages/domain/) for the vitest glob. */
  scanDirs: DIRS.map((d) => `src/${d}`),
  /** Glob for lefthook's `pre-push.policy-purity` trigger (pinned by test). */
  lefthookGlob: `packages/domain/src/(${DIRS.join("|")})/**/*.ts`,
};
