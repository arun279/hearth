import { Hono } from "hono";
import type { AppBindings } from "./bindings.ts";
import { activitiesRoutes } from "./routes/activities.ts";
import { adminRoutes } from "./routes/admin.ts";
import { groupsRoutes } from "./routes/groups.ts";
import { instanceRoutes } from "./routes/instance.ts";
import { invitationsRoutes } from "./routes/invitations.ts";
import { libraryRoutes } from "./routes/library.ts";
import { meRoutes } from "./routes/me.ts";
import { tracksRoutes } from "./routes/tracks.ts";

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
    .route("/tracks", tracksRoutes)
    .route("/library", libraryRoutes)
    .route("/invitations", invitationsRoutes)
    .route("/admin", adminRoutes)
    // Activities routes mount at "/" because the surface spans two
    // path roots: list/create live under `/tracks/:trackId/activities`
    // (track-scoped) while detail/mutations live under
    // `/activities/:activityId` (per-aggregate). Splitting into two
    // routers and mounting separately would require duplicating
    // session-auth middleware setup; one router with a "/" mount keeps
    // the contract co-located.
    .route("/", activitiesRoutes);
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
export { createDevR2ProxyRouter } from "./routes/dev-r2-proxy.ts";
