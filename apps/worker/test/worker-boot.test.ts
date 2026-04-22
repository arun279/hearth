import { describe, expect, it } from "vitest";
import worker, { type WorkerEnv } from "../src/index.ts";

/**
 * End-to-end smoke test for the Worker's boot path. Covers:
 *  - env parsing (Zod schema accepts the fake values below)
 *  - middleware composition (every repository factory constructs without throwing)
 *  - route mount paths (/healthz unversioned, /api/v1/* versioned)
 *  - basic response shapes
 *
 * We stub the Cloudflare bindings (`D1Database`, `R2Bucket`, etc.) as empty
 * objects — the stub repositories in packages/adapters/cloudflare/src/stub.ts
 * return Proxies that only throw on method access, so the routes exercised
 * here never touch the real DB. A full integration test with Miniflare is a
 * future addition once @cloudflare/vitest-pool-workers' new API stabilizes.
 *
 * If this file starts failing, the Worker is broken at the most basic
 * request-pipeline level. Common causes:
 *  - a repository factory started throwing at construction time
 *  - an env var was added to the schema without a matching fake below
 *  - a route path was renamed without updating the tests
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

  it("/api/v1/me/context returns the empty stub shape", async () => {
    const res = await fetchRoute("/api/v1/me/context");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      user: null,
      memberships: [],
      enrollments: [],
      isOperator: false,
    });
  });

  it("/api/v1/me/up-next returns an items array", async () => {
    const res = await fetchRoute("/api/v1/me/up-next");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [] });
  });
});
