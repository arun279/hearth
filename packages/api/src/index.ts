import { Hono } from "hono";
import type { AppBindings } from "./bindings.ts";
import { adminRoutes } from "./routes/admin.ts";
import { groupRoutes } from "./routes/groups.ts";
import { libraryRoutes } from "./routes/library.ts";
import { meRoutes } from "./routes/me.ts";
import { trackRoutes } from "./routes/tracks.ts";

/**
 * Builds the Hono app. apps/worker is the composition root — it adds
 * Better Auth at `/api/auth/*` and mounts this router at `/api/v1/*`.
 */
export function createApiRouter() {
  const app = new Hono<AppBindings>()
    .route("/me", meRoutes)
    .route("/admin", adminRoutes)
    .route("/g", groupRoutes)
    .route("/tracks", trackRoutes)
    .route("/library", libraryRoutes);

  return app;
}

export type ApiRouter = ReturnType<typeof createApiRouter>;

export type { AppBindings } from "./bindings.ts";
