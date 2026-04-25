import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Two-project setup:
 *
 *  - `unit`: existing mock-backed suites (`test/*.test.ts`). Fast, no runtime.
 *  - `integration`: Miniflare-hosted D1 + R2 (`test/integration/*.test.ts`).
 *    Runs the real schema migrations from `packages/db/migrations/` against a
 *    fresh Miniflare D1; tests import `env` / `applyD1Migrations` from the
 *    `cloudflare:test` virtual module. Migrations are surfaced as a test-only
 *    `TEST_MIGRATIONS` binding per the documented pattern.
 *
 * Absolute paths (via `import.meta.dirname`) are required by
 * `@cloudflare/vitest-pool-workers` ≥ 0.14 when the config lives outside the
 * Wrangler working directory.
 *
 * Why no `coverage.thresholds` here (intentional, not an oversight):
 * V8 coverage instrumentation does not work inside the Workers runtime —
 * the runtime does not expose the V8 profiler API that v8-to-istanbul
 * needs (per Vitest's own coverage docs). The adapter is exercised by
 * the Miniflare-backed integration suite under `test/integration/`,
 * which asserts behaviour against real D1 + R2 (atomic batch writes,
 * idempotent updates, killswitch gating, etc.). Adding a no-op
 * coverage script to satisfy a turbo task would only produce
 * misleading "0% covered" reports against unit-test-instrumented code
 * and ignore the integration suite. See `docs/tripwires.md` —
 * "v8 coverage on Workers runtime" — for the reassessment trigger.
 */
const thisDir = import.meta.dirname;
const wranglerConfigPath = path.join(thisDir, "test/wrangler.test.jsonc");
const migrationsDir = path.join(thisDir, "../../db/migrations");

export default defineConfig(async () => {
  const migrations = await readD1Migrations(migrationsDir);

  return {
    test: {
      projects: [
        {
          test: {
            name: "unit",
            include: ["test/*.test.ts"],
            exclude: ["test/integration/**"],
          },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: wranglerConfigPath },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }),
          ],
          test: {
            name: "integration",
            include: ["test/integration/*.test.ts"],
            setupFiles: [path.join(thisDir, "test/setup-miniflare.ts")],
          },
        },
      ],
    },
  };
});
