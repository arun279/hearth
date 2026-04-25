import { describe, expect, it } from "vitest";
import worker, { type WorkerEnv } from "../src/index.ts";

/**
 * Boot-path smoke test. Covers:
 *  - env parsing (Zod schema accepts the fake values below)
 *  - middleware composition (every repository factory constructs without throwing)
 *  - /healthz is reachable without touching D1 (critical — uptime probes must
 *    still work in `disabled` killswitch mode, and the killswitch middleware
 *    short-circuits before the route even runs)
 *
 * Route-level coverage for /api/v1/me/context and the admin endpoints lives in
 * `packages/api/test/*.test.ts`, where ports are mocked cleanly. The boot test
 * deliberately does NOT hit D1-backed routes with a fake `{} as D1Database` —
 * that would require a real Miniflare environment, which we provision via
 * @cloudflare/vitest-pool-workers in the adapter integration suite.
 */

const FAKE_ENV: WorkerEnv = {
  DB: {} as unknown as D1Database,
  STORAGE: {} as unknown as R2Bucket,
  ASSETS: {} as unknown as Fetcher,
  ANALYTICS: {} as unknown as AnalyticsEngineDataset,
  WRITE_LIMITER: {} as unknown as RateLimit,
  AUTH_LIMITER: {} as unknown as RateLimit,
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
  BETTER_AUTH_SECRET: "a".repeat(64),
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:8787",
  KILLSWITCH_TOKEN: "b".repeat(64),
  HEARTH_BOOTSTRAP_OPERATOR_EMAIL: "test@example.com",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_PUBLIC_ORIGIN: "https://pub-example.r2.dev",
};

const CTX = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

async function fetchRoute(path: string): Promise<Response> {
  if (!worker.fetch) throw new Error("worker.fetch is not defined");
  return await worker.fetch(new Request(`https://example.com${path}`), FAKE_ENV, CTX);
}

describe("worker boot", () => {
  it("/healthz returns 200 'ok'", async () => {
    const res = await fetchRoute("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
