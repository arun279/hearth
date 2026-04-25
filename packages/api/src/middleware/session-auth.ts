import type { UserId } from "@hearth/domain";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../bindings.ts";
import { problemResponse } from "../problem.ts";

/**
 * Session-cookie gate for routes that require an authenticated user. Returns
 * 401 with RFC 7807 `code: "unauthenticated"` when no session is attached.
 *
 * Route handlers downstream can treat `c.var.userId` as a non-null `UserId`
 * by re-reading it after this middleware. We do not publish a separate
 * Variable because the existing `userId: string | null` shape is already
 * wired throughout the app; narrowing via the `getUserId` helper keeps
 * intent explicit at each call site.
 */
export function sessionAuthMiddleware() {
  return createMiddleware<AppBindings>(async (c, next) => {
    if (c.var.userId === null) {
      return problemResponse(c, {
        type: "about:blank#unauthenticated",
        title: "unauthenticated",
        status: 401,
        detail: "Sign in to access this endpoint.",
        code: "unauthenticated",
      });
    }
    return next();
  });
}

/**
 * Use inside session-gated handlers to narrow `c.var.userId` to `UserId`
 * without another null check. The gate guarantees non-null; surfacing the
 * invariant loudly here beats returning a bogus value if a route is ever
 * wired up without the middleware.
 */
export function getUserId(c: { var: { userId: string | null } }): UserId {
  const id = c.var.userId;
  if (id === null) throw new Error("getUserId: userId unexpectedly null");
  return id as UserId;
}
