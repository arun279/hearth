import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Files under the SPA-pure directories of `packages/domain/src/` (see
 * `policy-pure-dirs.cjs` at the repo root) must stay SPA-importable —
 * no Node globals, no async, no `Date.now()`, no `crypto.*`, no
 * dynamic imports. The SPA imports these modules to compute UI
 * capabilities client-side and to render shared widgets; non-pure code
 * would leak into the browser bundle or depend on server-only APIs.
 *
 * Dep-cruiser's `policy-purity-no-node-globals` rule catches imports of
 * Node built-ins but cannot detect inline expressions like `Date.now()`.
 * This test does a source-text pass to close that gap.
 *
 * The directory list is the single-source-of-truth `policy-pure-dirs.cjs`
 * — both this test and `.dependency-cruiser.cjs` derive their scope
 * from it. The drift assertion below additionally pins the dep-cruiser
 * regex to the SoT-derived value, so editing one side directly is
 * caught at `pnpm test` time rather than via prose mirror-pointers.
 */

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const purityConfig = require(resolve(REPO_ROOT, "policy-pure-dirs.cjs")) as {
  readonly DIRS: readonly string[];
  readonly depCruiserFromPath: string;
  readonly scanDirs: readonly string[];
  readonly lefthookGlob: string;
};

const PACKAGE_ROOT = resolve(__dirname, "..");
const SCAN_DIRS = purityConfig.scanDirs;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

const candidates: readonly string[] = SCAN_DIRS.flatMap((dir) => {
  const root = resolve(PACKAGE_ROOT, dir);
  return Array.from(walk(root));
});

describe("policy purity", () => {
  it("discovers at least one policy file", () => {
    expect(candidates.length).toBeGreaterThan(0);
  });

  for (const absolute of candidates) {
    const rel = relative(PACKAGE_ROOT, absolute);
    it(`${rel} has no banned runtime APIs`, () => {
      const source = readFileSync(absolute, "utf8");

      // Strip comments so the rule fires only on executable code.
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

      expect(stripped, "no async functions").not.toMatch(/\basync\s+/);
      expect(stripped, "no await expressions").not.toMatch(/\bawait\s+/);
      expect(stripped, "no Date.now()").not.toMatch(/Date\.now\s*\(/);
      expect(stripped, "no new Date()").not.toMatch(/new\s+Date\s*\(/);
      expect(stripped, "no crypto.*").not.toMatch(/\bcrypto\./);
      expect(stripped, "no dynamic imports").not.toMatch(/import\s*\(/);
      expect(stripped, "no process.*").not.toMatch(/\bprocess\./);
      expect(stripped, "no performance.*").not.toMatch(/\bperformance\./);
      expect(stripped, "no global/globalThis").not.toMatch(/\bglobalThis\./);
    });
  }
});

describe("policy purity — paired-gate drift assertion", () => {
  it("dep-cruiser policy-purity-no-node-globals rule's from.path matches the SoT", () => {
    const cfg = require(resolve(REPO_ROOT, ".dependency-cruiser.cjs")) as {
      readonly forbidden: ReadonlyArray<{
        readonly name: string;
        readonly from: { readonly path?: string };
      }>;
    };
    const rule = cfg.forbidden.find((r) => r.name === "policy-purity-no-node-globals");
    expect(
      rule,
      "policy-purity-no-node-globals rule must exist in dep-cruiser config",
    ).toBeDefined();
    expect(rule?.from.path, "dep-cruiser regex must match policy-pure-dirs.cjs").toBe(
      purityConfig.depCruiserFromPath,
    );
  });

  it("lefthook pre-push policy-purity glob matches the SoT", () => {
    // The lefthook glob is a static YAML string (lefthook can't require()
    // the SoT module), so a stale glob silently under-triggers the
    // accelerator on newly-protected dirs. Pin it the same way as the
    // dep-cruiser regex: a regex extracts the glob line, and a mismatch
    // fails here rather than rotting unnoticed.
    const lefthook = readFileSync(resolve(REPO_ROOT, "lefthook.yml"), "utf8");
    const match = lefthook.match(/^\s+glob:\s*"(packages\/domain\/src\/\([^"]*\)\/\*\*\/\*\.ts)"/m);
    expect(match?.[1], "lefthook policy-purity glob must be present").toBeDefined();
    expect(match?.[1], "lefthook glob must match policy-pure-dirs.cjs lefthookGlob").toBe(
      purityConfig.lefthookGlob,
    );
  });
});
