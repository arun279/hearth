import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
 */

const CANDIDATES = [
  "packages/domain/src/policy/can-archive-group.ts",
  "packages/domain/src/policy/can-create-track.ts",
  "packages/domain/src/policy/can-enroll-in-track.ts",
  "packages/domain/src/policy/is-authority-over-track.ts",
  "packages/domain/src/policy/index.ts",
  "packages/domain/src/visibility/index.ts",
];

// Repo-root-relative paths — tests run from the workspace root
// (via pnpm --filter @hearth/domain test) but resolve from package cwd.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("policy purity", () => {
  for (const rel of CANDIDATES) {
    it(`${rel} has no banned runtime APIs`, () => {
      const source = readFileSync(resolve(REPO_ROOT, rel), "utf8");

      // Strip comments so the rule fires only on executable code.
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

      expect(stripped, "no async functions").not.toMatch(/\basync\s+/);
      expect(stripped, "no await expressions").not.toMatch(/\bawait\s+/);
      expect(stripped, "no Date.now()").not.toMatch(/Date\.now\s*\(/);
      expect(stripped, "no new Date()").not.toMatch(/new\s+Date\s*\(/);
      expect(stripped, "no crypto.*").not.toMatch(/\bcrypto\./);
      expect(stripped, "no dynamic imports").not.toMatch(/import\s*\(/);
      expect(stripped, "no process.*").not.toMatch(/\bprocess\./);
    });
  }
});
