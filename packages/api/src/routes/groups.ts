import { Hono } from "hono";
import type { AppBindings } from "../bindings.ts";

export const groupRoutes = new Hono<AppBindings>().get("/:groupId", (c) => {
  return c.json({ id: c.req.param("groupId"), name: null });
});
