import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Apply D1 migrations to the e2e environment before any spec runs. The
 * e2e binding (see `apps/worker/wrangler.jsonc` `env.e2e.d1_databases`)
 * is a different Miniflare sqlite file from the dev D1 — keeping the
 * developer's local state untouched by `resetInstanceState` teardown
 * SQL — but that isolation means the e2e DB starts empty on a fresh
 * `.wrangler/state/v3/d1/<hash>.sqlite` and needs migrations applied
 * before the Worker can serve any request.
 *
 * `wrangler d1 migrations apply` is idempotent: re-runs check the
 * applied-versions metadata and no-op when the schema is current. Safe
 * to invoke on every spec-run regardless of state.
 */
export default function globalSetup(): void {
  if (!process.env["HEARTH_WRANGLER_ENV"]) {
    process.env["HEARTH_WRANGLER_ENV"] = "e2e";
  }
  const res = spawnSync(
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
    ],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (res.status !== 0) {
    throw new Error(
      `wrangler d1 migrations apply (env=e2e) failed:\n${res.stderr || res.stdout || "unknown error"}`,
    );
  }
}
