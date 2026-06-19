import { defineConfig } from "vitest/config";

/**
 * Mirrors `apps/web/vitest.config.ts`: two projects split the primitives'
 * tests by environment so the token/SSR-string tests stay on the fast node
 * path while interaction tests for stateful primitives (Popover, Modal,
 * RadioGroup focus-trap, etc.) mount in happy-dom.
 *
 *   - `unit` runs `test/**` `.test.{ts,tsx}` on node, excluding the DOM suffix.
 *   - `dom` runs `test/**` `.dom.test.tsx` in happy-dom with the jest-dom +
 *     Testing Library cleanup setup.
 *
 * Tests are routed to an environment by config (the `*.dom.test.tsx` suffix),
 * never a per-file `// @vitest-environment` docblock.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.test.{ts,tsx}"],
          exclude: ["**/*.dom.test.tsx"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["test/**/*.dom.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
