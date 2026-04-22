import { Hono } from "hono";
import type { AppBindings } from "../bindings.ts";

export const meRoutes = new Hono<AppBindings>()
  .get("/context", (c) => {
    return c.json({ user: null, memberships: [], enrollments: [], isOperator: false });
  })
  .get("/up-next", (c) => {
    return c.json({ items: [] });
  });
