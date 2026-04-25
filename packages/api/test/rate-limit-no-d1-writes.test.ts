import type { KillswitchGate } from "@hearth/ports";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppBindings, RateLimitHandle } from "../src/bindings.ts";
import { authRateLimit, writeRateLimit } from "../src/middleware/rate-limit.ts";

/**
 * CI-enforced resilience invariant (per docs/free-tier-guardrails.md §4):
 * the Cloudflare Rate Limiting binding keeps its counters in an internal
 * per-colo edge store — NEVER in D1, KV, or Durable Objects. This test
 * drives 100 requests through the middleware with a hostile `ports` proxy
 * that throws on any access, proving the rate-limit path does not touch
 * the D1-backed repositories (or any other bound resource).
 *
 * If a future change makes rate-limiting consult ports/db, this test fails
 * loudly. That is by design — the runaway-usage guarantee in the guardrails
 * doc depends on rate-limit counters never consuming D1 quota.
 */

function throwingProxy<T extends object>(label: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(`unexpected ${label} access during rate-limit`);
    },
  });
}

function makeGate(): KillswitchGate {
  return {
    getMode: async () => "normal",
    assertWritable: async () => {},
    invalidate: () => {},
  };
}

function installVars(
  app: Hono<AppBindings>,
  opts: { readonly userId?: string | null; readonly limit: RateLimitHandle["limit"] },
) {
  app.use("*", async (c, next) => {
    c.set("userId", opts.userId ?? null);
    c.set("auth", { handler: async () => new Response(null) });
    c.set("gate", makeGate());
    c.set("adminToken", "a".repeat(64));
    c.set("writeLimiter", { limit: opts.limit });
    c.set("authLimiter", { limit: opts.limit });
    c.set("ports", {
      policy: throwingProxy("policy"),
      settings: throwingProxy("settings"),
      users: throwingProxy("users"),
      groups: throwingProxy("groups"),
      tracks: throwingProxy("tracks"),
      libraryItems: throwingProxy("libraryItems"),
      activities: throwingProxy("activities"),
      records: throwingProxy("records"),
      sessions: throwingProxy("sessions"),
      storage: throwingProxy("storage"),
      flags: throwingProxy("flags"),
      clock: { now: () => new Date(0) },
      ids: { generate: () => "id_fuzz" },
    });
    await next();
  });
}

describe("rate-limit does not touch D1 (resilience invariant 4)", () => {
  it("100 throttled writes never access the ports proxy", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const app = new Hono<AppBindings>();
    installVars(app, { userId: "u_fuzz", limit });
    app.use("*", writeRateLimit());
    app.post("/noop", (c) => c.text("ok"));

    for (let i = 0; i < 100; i++) {
      const res = await app.request("/noop", { method: "POST" });
      expect(res.status).toBe(200);
    }
    expect(limit).toHaveBeenCalledTimes(100);
  });

  it("returns 429 RFC 7807 when the binding rejects", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const app = new Hono<AppBindings>();
    installVars(app, { userId: "u_over", limit });
    app.use("*", writeRateLimit());
    app.post("/noop", (c) => c.text("ok"));

    const res = await app.request("/noop", { method: "POST" });
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "rate_limited", status: 429 });
  });

  it("lets non-write methods through without metering", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const app = new Hono<AppBindings>();
    installVars(app, { userId: "u_reader", limit });
    app.use("*", writeRateLimit());
    app.get("/noop", (c) => c.text("ok"));

    const res = await app.request("/noop");
    expect(res.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });

  it("keys per-IP when no userId — falling back through cf-connecting-ip → x-forwarded-for → unknown-ip", async () => {
    // 1: cf-connecting-ip wins
    {
      const limit = vi.fn(async () => ({ success: true }));
      const app = new Hono<AppBindings>();
      installVars(app, { userId: null, limit });
      app.use("*", writeRateLimit());
      app.post("/noop", (c) => c.text("ok"));
      await app.request("/noop", { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" } });
      expect(limit).toHaveBeenCalledWith({ key: "1.2.3.4" });
    }
    // 2: cf-connecting-ip absent → x-forwarded-for first comma-segment
    {
      const limit = vi.fn(async () => ({ success: true }));
      const app = new Hono<AppBindings>();
      installVars(app, { userId: null, limit });
      app.use("*", writeRateLimit());
      app.post("/noop", (c) => c.text("ok"));
      await app.request("/noop", {
        method: "POST",
        headers: { "x-forwarded-for": " 9.9.9.9 ,  10.0.0.1 " },
      });
      expect(limit).toHaveBeenCalledWith({ key: "9.9.9.9" });
    }
    // 3: both absent → "unknown-ip" sentinel
    {
      const limit = vi.fn(async () => ({ success: true }));
      const app = new Hono<AppBindings>();
      installVars(app, { userId: null, limit });
      app.use("*", writeRateLimit());
      app.post("/noop", (c) => c.text("ok"));
      await app.request("/noop", { method: "POST" });
      expect(limit).toHaveBeenCalledWith({ key: "unknown-ip" });
    }
  });
});

describe("authRateLimit (resilience invariant 4 — same edge counter, no D1)", () => {
  it("meters every request against the auth limiter binding using IP", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const app = new Hono<AppBindings>();
    installVars(app, { limit });
    app.use("*", authRateLimit());
    app.get("/api/auth/sign-in", (c) => c.text("ok"));
    const res = await app.request("/api/auth/sign-in", {
      headers: { "cf-connecting-ip": "5.5.5.5" },
    });
    expect(res.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: "5.5.5.5" });
  });

  it("returns 429 RFC 7807 when the auth binding rejects", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const app = new Hono<AppBindings>();
    installVars(app, { limit });
    app.use("*", authRateLimit());
    app.get("/api/auth/sign-in", (c) => c.text("ok"));
    const res = await app.request("/api/auth/sign-in", {
      headers: { "cf-connecting-ip": "5.5.5.5" },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "rate_limited", status: 429 });
  });
});
