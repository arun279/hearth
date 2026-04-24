import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Files under `packages/domain/src/policy/**` and `packages/domain/src/visibility/**`
 * must stay SPA-importable — no Node globals, no async, no `Date.now()`,
 * no `crypto.*`, no dynamic imports. The SPA imports these modules to
 * compute UI capabilities client-side; non-pure code would leak into the
 * browser bundle or depend on server-only APIs that don't exist there.
 *
 * Dep-cruiser's `policy-purity-no-node-globals` rule catches imports of
 * Node built-ins but cannot detect inline expressions like `Date.now()`.
 * This test does a source-text pass to close that gap.
 *
 * New policy and visibility files are picked up automatically — the glob
 * below walks the source dirs, so there is no hand-maintained file list
 * that can drift.
 */

const PACKAGE_ROOT = resolve(__dirname, "..");
const SCAN_DIRS = ["src/policy", "src/visibility"] as const;

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
