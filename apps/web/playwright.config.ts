import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SPA_PORT = 5173;
const WORKER_PORT = 8787;

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
      // The Vite SPA. `@hearth/web dev` proxies `/api/*` to the Worker on 8787,
      // so cookies set on the SPA origin flow through to the Worker via the
      // proxy as same-origin requests.
      command: "pnpm --filter @hearth/web dev",
      cwd: path.resolve(__dirname, "../.."),
      url: `http://localhost:${SPA_PORT}/`,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      stderr: "pipe",
      stdout: "ignore",
    },
    {
      command: "pnpm --filter @hearth/worker dev",
      cwd: path.resolve(__dirname, "../.."),
      url: `http://localhost:${WORKER_PORT}/healthz`,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      stderr: "pipe",
      stdout: "ignore",
    },
  ],
});
