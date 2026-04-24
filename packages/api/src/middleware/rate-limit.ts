import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../bindings.ts";
import { problemResponse } from "../problem.ts";

/**
 * Cloudflare Workers Rate Limiting API binding. Legal `period` values per
 * Cloudflare docs are exactly `10` or `60`; we wire two bindings in
 * wrangler.jsonc — WRITE_LIMITER (60 ops/min/user) and AUTH_LIMITER
 * (10 attempts/min/IP). Both back onto internal edge counters, NOT D1/KV/DO,
 * which the CI invariant rate-limit-no-d1-writes.test.ts re-asserts so a
 * future binding swap cannot silently break the guarantee.
 */
export type RateLimiterBinding = {
  limit(opts: { readonly key: string }): Promise<{ readonly success: boolean }>;
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function ipOf(c: Context<AppBindings>): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown-ip"
  );
}

/**
 * Throttle POST/PUT/PATCH/DELETE per user (or per-IP when anon) against the
 * writeLimiter binding exposed through AppBindings.Variables. Reads pass
 * through. Install AFTER the killswitch middleware so admin flips are not
 * throttled.
 */
export function writeRateLimit() {
  return createMiddleware<AppBindings>(async (c, next) => {
    if (!WRITE_METHODS.has(c.req.method)) return next();
    const key = c.var.userId ?? ipOf(c);
    const { success } = await c.var.writeLimiter.limit({ key });
    if (!success) {
      return problemResponse(c, {
        type: "about:blank#rate_limited",
        title: "too many requests",
        status: 429,
        detail: "Too many writes from your session. Slow down and try again.",
        code: "rate_limited",
      });
    }
    return next();
  });
}

/**
 * Throttle /api/auth/* requests per IP against the authLimiter binding.
 * Scoped to the auth prefix so OAuth/session endpoints are metered but the
 * rest of the API isn't.
 */
export function authRateLimit() {
  return createMiddleware<AppBindings>(async (c, next) => {
    const { success } = await c.var.authLimiter.limit({ key: ipOf(c) });
    if (!success) {
      return problemResponse(c, {
        type: "about:blank#rate_limited",
        title: "too many requests",
        status: 429,
        detail: "Too many auth attempts from this IP. Try again in a minute.",
        code: "rate_limited",
      });
    }
    return next();
  });
}
