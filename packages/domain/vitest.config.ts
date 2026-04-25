import { defineConfig } from "vitest/config";

/**
 * Domain layer thresholds. Per published hexagonal-architecture guidance:
 * the domain is pure functions with no I/O — every branch is reachable from
 * a unit test and there's no excuse not to cover it. Erard's coverage-
 * hardening writeup hits 95–99% on the equivalent layer; we set 95%.
 *
 * Includes only runtime-bearing files. `instance.ts`, `group.ts`, `track.ts`,
 * `user.ts`, `me-context.ts`, `ids.ts` are pure type declarations — they
 * compile to nothing, so coverage on them is meaningless. `parts/**` lands
 * with M8 (Activity composition) and gets its own threshold then.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/policy/**/*.ts", "src/visibility/**/*.ts", "src/errors.ts"],
      reporter: ["text-summary", "text"],
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
  },
});
