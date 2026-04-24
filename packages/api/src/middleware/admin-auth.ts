import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../bindings.ts";
import { problemResponse } from "../problem.ts";

/**
 * Constant-time comparison. `timingSafeEqual` isn't in Workers' runtime, so
 * we fall back to an XOR sum that avoids short-circuit behavior on length.
 */
function secureEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Bearer-token gate for /api/v1/admin/* endpoints. The token is a Workers
 * secret (`KILLSWITCH_TOKEN`) owned by the operator; never logged, never
 * returned in response bodies. Also accepted via `?token=` query parameter
 * so a bookmark is usable from a phone without a header-capable client.
 */
export function adminAuthMiddleware() {
  return createMiddleware<AppBindings>(async (c, next) => {
    const header = c.req.header("authorization");
    const headerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const queryToken = c.req.query("token") ?? null;
    const provided = headerToken ?? queryToken;

    if (!provided || !secureEqual(provided, c.var.adminToken)) {
      return problemResponse(c, {
        type: "about:blank#unauthorized",
        title: "unauthorized",
        status: 401,
        detail: "A valid admin bearer token is required for this endpoint.",
        code: "unauthorized",
      });
    }
    return next();
  });
}
