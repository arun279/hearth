/**
 * Single source of truth for the "SPA-pure" directories under
 * `packages/domain/src/`. These dirs hold modules the SPA imports for
 * client-side capability + visibility computation; they must stay
 * free of Node globals, async, `Date.now()`, `crypto.*`, and dynamic
 * imports.
 *
 * Two paired gates consume this file:
 *
 *   1. `.dependency-cruiser.cjs` — `policy-purity-no-node-globals` rule.
 *      Catches Node-built-in IMPORTS at the dep-graph level.
 *
 *   2. `packages/domain/test/policy-purity.test.ts` — Vitest source-text
 *      scan. Catches inline EXPRESSIONS (`Date.now()`, `crypto.*`) that
 *      dep-cruiser cannot see.
 *
 * Both must scope identically. Editing the regex on the dep-cruiser
 * side directly is structurally impossible: it builds the regex from
 * the array exported here, and a vitest drift assertion (in the same
 * file as the source-text scan) compares the loaded dep-cruiser config's
 * `from.path` literal against the expected regex string.
 *
 * To add a new SPA-pure directory: append to `DIRS` and run the test —
 * both checks update in lockstep with no further edits.
 */
const DIRS = ["policy", "visibility", "library", "parts"];

module.exports = {
  DIRS,
  /** Regex string for dep-cruiser's `from.path`. */
  depCruiserFromPath: `^packages/domain/src/(${DIRS.join("|")})/`,
  /** Path strings (relative to packages/domain/) for the vitest glob. */
  scanDirs: DIRS.map((d) => `src/${d}`),
};
