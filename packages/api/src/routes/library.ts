import { Hono } from "hono";
import type { AppBindings } from "../bindings.ts";

export const libraryRoutes = new Hono<AppBindings>().post("/upload-request", (c) => {
  return c.json({ uploadUrl: null, libraryItemId: null });
});
