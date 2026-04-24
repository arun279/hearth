import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../bindings.ts";
import { problemForKillswitch, problemResponse } from "../problem.ts";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Kill-switch at the HTTP boundary. Runs before any route handler.
 *
 * - `normal`: pass-through.
 * - `read_only`: POST/PUT/PATCH/DELETE return 503 problem+json `code: "read_only"`.
 * - `disabled`: every request returns 503 except `/healthz` (liveness probe) and
 *   `/api/v1/admin/*` (operator-recovery endpoints). This keeps the killswitch
 *   itself reachable so an operator can flip back to normal without redeploying.
 *
 * `c.req.path` is the full path including any router mount prefix. Because this
 * middleware is installed at the apps/worker root, the admin prefix shows up as
 * `/api/v1/admin/...` exactly.
 */
export function killswitchMiddleware() {
  return createMiddleware<AppBindings>(async (c, next) => {
    const mode = await c.var.gate.getMode();
    if (mode === "normal") return next();

    const path = c.req.path;
    const isHealth = path === "/healthz";
    const isAdmin = path.startsWith("/api/v1/admin/");

    if (mode === "disabled" && !isHealth && !isAdmin) {
      return problemResponse(c, problemForKillswitch("disabled"));
    }
    if (mode === "read_only" && WRITE_METHODS.has(c.req.method) && !isAdmin) {
      return problemResponse(c, problemForKillswitch("read_only"));
    }
    return next();
  });
}
