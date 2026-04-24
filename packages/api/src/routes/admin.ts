import type { KillswitchMode } from "@hearth/ports";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { adminAuthMiddleware } from "../middleware/admin-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

const flipBody = z.object({
  mode: z.enum(["normal", "read_only", "disabled"]),
  reason: z.string().max(500).optional(),
});

function isKillswitchMode(v: string | null): v is KillswitchMode {
  return v === "normal" || v === "read_only" || v === "disabled";
}

/**
 * Operator endpoints. Bearer-authed via `KILLSWITCH_TOKEN` (Workers secret).
 * Deliberately exempt from the HTTP killswitch middleware so an operator
 * can flip back out of `disabled` without redeploying — see
 * middleware/killswitch.ts for the carve-out.
 */
export const adminRoutes = new Hono<AppBindings>()
  .use("*", adminAuthMiddleware())
  .get("/killswitch", async (c) => {
    try {
      const [rawMode, reason, lastTransition] = await Promise.all([
        c.var.ports.flags.get("killswitch_mode"),
        c.var.ports.flags.get("killswitch_reason"),
        c.var.ports.flags.get("killswitch_last_transition_at"),
      ]);
      const mode: KillswitchMode = isKillswitchMode(rawMode) ? rawMode : "normal";
      return c.json({
        mode,
        reason: reason ?? null,
        lastTransitionAt: lastTransition ?? null,
      });
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })
  .post("/killswitch", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return problemResponse(c, {
        type: "about:blank#invalid_json",
        title: "invalid json",
        status: 400,
        detail: "Request body must be valid JSON.",
        code: "invalid_json",
      });
    }
    const parsed = flipBody.safeParse(raw);
    if (!parsed.success) {
      return problemResponse(c, problemFromZodError(parsed.error));
    }
    const { mode, reason } = parsed.data;
    const now = new Date().toISOString();
    try {
      // Ordering matters: write metadata first, then flip `killswitch_mode`
      // last. `mode` is what the adapter gate and HTTP middleware enforce
      // on; a failure before the mode flip leaves enforcement unchanged.
      // A failure after leaves mode and metadata in sync (successful flip).
      // The worst transient window is: a reader between the metadata write
      // and the mode write sees the new reason but the old mode — cosmetic,
      // not a correctness hole.
      await c.var.ports.flags.set("killswitch_reason", reason ?? "");
      await c.var.ports.flags.set("killswitch_last_transition_at", now);
      await c.var.ports.flags.set("killswitch_mode", mode);
    } catch (err) {
      c.var.gate.invalidate();
      return problemResponse(c, mapUnknown(err));
    }
    c.var.gate.invalidate();
    return c.json({ mode, reason: reason ?? null, lastTransitionAt: now });
  })
  // Real implementation lands with the operator health dashboard. Until then,
  // return a shape-stable empty payload so the operator UI can develop against
  // a real endpoint.
  .get("/health", (c) =>
    c.json({
      metrics: [],
      killswitch: { mode: "normal" as KillswitchMode, reason: null, lastTransitionAt: null },
      evidenceSignalCount: 0,
    }),
  );
