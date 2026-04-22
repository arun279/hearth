import { Hono } from "hono";
import type { AppBindings } from "../bindings.ts";

export const adminRoutes = new Hono<AppBindings>()
  .get("/killswitch", (c) => {
    return c.json({ mode: "normal", reason: null });
  })
  .post("/killswitch", (c) => {
    return c.json({ mode: "normal" });
  })
  .get("/health", (c) => {
    return c.json({ metrics: [] });
  });
