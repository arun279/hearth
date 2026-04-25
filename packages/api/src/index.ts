import { Hono } from "hono";
import type { AppBindings } from "./bindings.ts";
import { adminRoutes } from "./routes/admin.ts";
import { groupsRoutes } from "./routes/groups.ts";
import { instanceRoutes } from "./routes/instance.ts";
import { meRoutes } from "./routes/me.ts";

/**
 * Builds the Hono app under `/api/v1/*`. apps/worker is the composition root —
 * it wires Better Auth at `/api/auth/*` and mounts this router.
 *
 * Route groups land as their aggregates ship (groups, tracks, library, etc.).
 * Keeping this router lean until then avoids dead endpoints the SPA could
 * accidentally call.
 */
export function createApiRouter() {
  const app = new Hono<AppBindings>()
    .route("/me", meRoutes)
    .route("/instance", instanceRoutes)
    .route("/g", groupsRoutes)
    .route("/admin", adminRoutes);
  return app;
}

export type ApiRouter = ReturnType<typeof createApiRouter>;

export type { AppBindings, AuthHandle } from "./bindings.ts";
export { killswitchMiddleware } from "./middleware/killswitch.ts";
export {
  authRateLimit,
  type RateLimiterBinding,
  writeRateLimit,
} from "./middleware/rate-limit.ts";
export {
  mapUnknown,
  type Problem,
  problemForKillswitch,
  problemFromDomainError,
  problemFromZodError,
  problemResponse,
  unknownErrorProblem,
} from "./problem.ts";
