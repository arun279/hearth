import { defineConfig } from "vitest/config";

/**
 * Two projects split the SPA's source-scoped tests by environment so the
 * fast pure/SSR-string tests never pay DOM-setup cost:
 *
 *   - `unit` runs the pure-helper and `renderToString`/`renderToStaticMarkup`
 *     tests on the node environment (`*.test.{ts,tsx}`, excluding the DOM
 *     suffix below).
 *   - `dom` mounts components in happy-dom for stateful behaviour — user
 *     events, async transitions, focus, fetch-driven state, timers, and
 *     visibility/unmount effects (`*.dom.test.tsx`). Its setup file wires the
 *     jest-dom matchers and Testing Library's per-test cleanup.
 *
 * Tests are routed to an environment by config (the `*.dom.test.tsx` suffix),
 * never a per-file `// @vitest-environment` docblock. Both projects' `include`
 * patterns also give knip's vitest plugin authoritative file/dependency
 * patterns so co-located tests and the DOM toolchain are recognized as used.
 *
 * The companion bundle-budget gate is in `vitest.bundle.config.ts` because it
 * runs a `vite build` in `beforeAll` and is too slow for the inner test loop.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["**/*.dom.test.tsx"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["src/**/*.dom.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
