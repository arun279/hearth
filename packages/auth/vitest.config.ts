import { defineConfig } from "vitest/config";

/**
 * Auth package thresholds. Bootstrap and admission paths are critical and
 * testable; the Better Auth wiring (`create-auth.ts`) is a thin composition
 * file that's hard to unit-test meaningfully and is exercised by the auth
 * provider tests via integration paths.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/admission.ts", "src/session-guard.ts"],
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
