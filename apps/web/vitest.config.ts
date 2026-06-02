import { defineConfig } from "vitest/config";

/**
 * Vitest config for the SPA's source-scoped unit tests. The
 * `package.json` `test` script also scopes via `--dir src`, but
 * declaring `include` here gives knip's vitest plugin an
 * authoritative file pattern so co-located `*.test.{ts,tsx}` files
 * are recognized as test entries (and therefore not flagged as
 * unused) without needing per-file allowlist entries.
 *
 * The companion bundle-budget gate is in `vitest.bundle.config.ts`
 * because it runs a `vite build` in `beforeAll` and is therefore
 * too slow to belong in the inner test loop.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
