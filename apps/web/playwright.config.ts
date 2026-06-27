import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// E2E uses sibling ports of the dev stack so a developer running
// `pnpm dev` (5173 + 8787) doesn't lose their session every time
// playwright spins up. The e2e Worker is bound to `env.e2e` in
// `apps/worker/wrangler.jsonc`, which selects a distinct Miniflare
// D1 sqlite file — schema is identical, rows are isolated.
const SPA_PORT = 5174;
const WORKER_PORT = 8788;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_PERSIST_DIR = path.resolve(REPO_ROOT, "apps/worker/.wrangler/state-e2e");
const SPA_DIST_INDEX = path.resolve(REPO_ROOT, "apps/web/dist/index.html");

// One-shot prep that runs in the Playwright runner process (skipped in
// spec workers via `TEST_WORKER_INDEX`). Two steps:
//
//   1. Build the SPA when `apps/web/dist` is missing. The `wrangler dev`
//      webServer points its `assets.directory` at `../web/dist`; without
//      that directory wrangler refuses to start. Tests still hit Vite on
//      `:5174`, so dist is only here to satisfy wrangler's start-up check
//      — but it MUST exist. Turbo caches the build so subsequent runs
//      are instant if nothing changed.
//
//   2. Reset the e2e persist dir to empty, then apply this branch's full
//      migration set from scratch. `wrangler d1 migrations apply` only runs
//      files not already recorded in `d1_migrations`, so it can never
//      reconcile a dir left carrying a different branch's schema (a migration
//      this branch lacks, or one it adds atop an object another branch already
//      created) — that drift produces a false-fail or, worse, a false-pass.
//      Wiping first makes every run replay the checked-out branch's exact
//      migrations, identical to a fresh CI runner that has no persist dir at
//      all. The dir is a sibling of the dev `state` dir, so wiping it never
//      touches a `pnpm dev` session. Row-level isolation between specs is
//      handled by `resetInstanceState` in `apps/web/e2e/auth.ts`.
// `HEARTH_WRANGLER_ENV === "e2e"` is set by the `pnpm e2e` script (see
// `apps/web/package.json`) — the only context where this build + migrate
// pair is wanted. Skip otherwise so an editor opening this file for
// typecheck / IDE completion doesn't trigger a full SPA build + a
// d1-migrations subprocess. Worker processes spawned by Playwright also
// inherit `HEARTH_WRANGLER_ENV` but additionally carry `TEST_WORKER_INDEX`,
// so they skip on the second guard.
if (process.env["HEARTH_WRANGLER_ENV"] === "e2e" && !process.env["TEST_WORKER_INDEX"]) {
  if (!existsSync(SPA_DIST_INDEX)) {
    const build = spawnSync("pnpm", ["--filter", "@hearth/web", "build"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (build.status !== 0) {
      throw new Error(
        `pnpm --filter @hearth/web build failed:\n${build.stderr || build.stdout || "unknown error"}`,
      );
    }
  }

  rmSync(E2E_PERSIST_DIR, { recursive: true, force: true });

  const migrate = spawnSync(
    "pnpm",
    [
      "--filter",
      "@hearth/worker",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "hearth",
      "--local",
      "--env",
      "e2e",
      "--persist-to",
      E2E_PERSIST_DIR,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (migrate.status !== 0) {
    throw new Error(
      `wrangler d1 migrations apply (env=e2e) failed:\n${migrate.stderr || migrate.stdout || "unknown error"}`,
    );
  }
}

/**
 * Playwright drives the SPA + Worker stack as a real user. Because Better Auth
 * delegates to Google OAuth — which has no headless test mode — every test
 * suite mints its own session via the global setup helper rather than going
 * through the OAuth dance. The helper writes directly into the same D1 the
 * Worker reads, then signs a session cookie with `BETTER_AUTH_SECRET` so the
 * Worker accepts it as a legitimate session. This isolates auth from feature
 * tests without weakening production auth.
 *
 * --- Authoring principle for specs in `e2e/` ---
 *
 * Specs encode user *intent*, not implementation. A good assertion looks
 * like "operator creates a Study Group, archives it, sees the banner";
 * a bad one looks like "the dialog has exactly four form fields with
 * these labels in this order." Intent-level assertions stay correct
 * across UI evolution; over-specified ones turn into immovable tarpits
 * that future changes have to bend around.
 *
 * Practical rules:
 *   1. Prefer `getByRole(...)` / `getByText(...)` over CSS selectors.
 *      Roles + accessible names are stable; class names are not.
 *   2. Assert behaviour, not chrome. "Toast confirms; row appears in
 *      list" is behaviour. "Button has class `bg-blue-500`" is chrome.
 *   3. When a feature genuinely changes intent (e.g., archive flow
 *      moves from a confirm dialog to inline-undo), update the spec.
 *      A spec that fails because the intent shifted is doing its job;
 *      working around it is the antipattern.
 *   4. Write specs at the journey level. One spec per canonical user
 *      flow per milestone, not one spec per UI affordance.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: path.resolve(__dirname, "e2e/global-setup.ts"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  // `retries: 2` matches Playwright's documented CI default. A retry budget
  // of 2 is the smallest count that produces useful flake telemetry (one
  // retry tells you "did it pass on retry?" — two retries discriminates
  // "deterministically broken" from "really flaky"). Locally we keep 0 so
  // a flake isn't masked during dev.
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${SPA_PORT}`,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    // `trace: 'on-first-retry'` only collects a trace when a retry actually
    // happens — same artifact volume as `retain-on-failure` for our run
    // shape, but the trace is captured at the moment the first run failed
    // (more debugging signal than a bare failure stack).
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: `pnpm exec vite --port ${SPA_PORT}`,
      env: {
        HEARTH_SPA_PORT: String(SPA_PORT),
        HEARTH_API_PROXY_PORT: String(WORKER_PORT),
      },
      cwd: path.resolve(__dirname),
      url: `http://localhost:${SPA_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      stderr: "pipe",
      stdout: "ignore",
    },
    {
      command: `pnpm exec wrangler dev --env e2e --port ${WORKER_PORT} --persist-to ./.wrangler/state-e2e`,
      cwd: path.resolve(__dirname, "../worker"),
      url: `http://localhost:${WORKER_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      stderr: "pipe",
      stdout: "ignore",
    },
  ],
});
