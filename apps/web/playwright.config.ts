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
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${SPA_PORT}`,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "retain-on-failure",
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
