import { defineConfig } from "vitest/config";

/**
 * Application/use-case layer thresholds. Use cases are orchestration over
 * mocked ports — every branch is reachable from a unit test, so the floor
 * is high. Slightly below the domain layer's 95% because catch-blocks for
 * adapter throws are real but rarely exercised in unit tests.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/use-cases/**/*.ts"],
      reporter: ["text-summary", "text"],
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
