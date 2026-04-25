import { defineConfig } from "vitest/config";

/**
 * API layer thresholds. Route handlers + middleware combined. Defensive
 * catch blocks for adapter throws are real but exercised rarely; the floor
 * here is set just below the use-case layer to accommodate that residual.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/routes/**/*.ts", "src/middleware/**/*.ts", "src/problem.ts"],
      reporter: ["text-summary", "text"],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 85,
        statements: 85,
      },
    },
  },
});
