import { Hono } from "hono";
import type { AppBindings } from "../bindings.ts";

export const trackRoutes = new Hono<AppBindings>()
  .get("/:trackId", (c) => {
    return c.json({ id: c.req.param("trackId"), name: null });
  })
  .get("/:trackId/summary", (c) => {
    return c.json({
      trackId: c.req.param("trackId"),
      pendingContributionCount: 0,
      upcomingSessionCount: 0,
      activityCount: 0,
      newRevisionsSinceLastVisit: 0,
    });
  });
