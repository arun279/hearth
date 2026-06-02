import { defineConfig } from "vitest/config";

/**
 * Separate Vitest config for the bundle-budget gate. The main `pnpm test`
 * scope is `vitest run --dir src`, which excludes this directory so the
 * inner dev loop stays fast — building the SPA bundle in `beforeAll`
 * takes ~10 s on a warm cache. CI invokes this config via the workspace
 * `test:bundle` script, wired into `pnpm check` at the root.
 *
 * The gate enforces a load-bearing invariant: heavy renderers (PDF,
 * video provider iframes' helper code) must stay behind `React.lazy()`
 * so the common-path JS bundle remains tractable. A future regression
 * that mistakenly imports `react-pdf` at the top of a non-lazy route
 * fails this gate the moment it lands, not when the bundle balloons
 * past the budget weeks later.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
