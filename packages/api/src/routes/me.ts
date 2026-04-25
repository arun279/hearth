import { getMeContext } from "@hearth/core";
import type { UserId } from "@hearth/domain";
import { Hono } from "hono";
import type { AppBindings } from "../bindings.ts";
import { mapUnknown, problemResponse } from "../problem.ts";

export const meRoutes = new Hono<AppBindings>()
  .get("/context", async (c) => {
    const userId = c.var.userId as UserId | null;
    try {
      const ctx = await getMeContext(
        { userId },
        {
          users: c.var.ports.users,
          policy: c.var.ports.policy,
          settings: c.var.ports.settings,
          groups: c.var.ports.groups,
        },
      );
      return c.json(ctx);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })
  // Real implementation lands with the Sessions aggregate. Until then the
  // SPA renders an empty "Up next" list so navigation doesn't dead-end.
  .get("/up-next", (c) => c.json({ items: [] }));
