import { consumeGroupInvitation, previewInvitation } from "@hearth/core";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { getUserId, sessionAuthMiddleware } from "../middleware/session-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

/**
 * Tokens are cuid2-shaped after `mintToken` — base64url, ≤48 chars; we
 * cap at 128 so an obviously-malformed URL produces a 400 with a stable
 * code instead of a 404 mid-handler.
 */
const tokenParam = z.object({ token: z.string().min(1).max(128) });

const consumeBody = z.object({ token: z.string().min(1).max(128) });

function problemFromInvalid(c: Context, error: unknown) {
  return problemResponse(c, problemFromZodError(error as z.ZodError));
}

export const invitationsRoutes = new Hono<AppBindings>()
  // GET /by-token/:token — unauthenticated preview. Anyone with the
  // token may read this; it returns just enough to render the consume
  // landing copy (group name + invitee email + status).
  .get(
    "/by-token/:token",
    zValidator("param", tokenParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { token } = c.req.valid("param");
      try {
        const result = await previewInvitation(
          { token, now: new Date() },
          { groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // POST /consume — authenticated consume. The route requires a session;
  // the SPA's invite landing redirects to sign-in first, then re-lands
  // with `?next=/invite/:token` so consume is always called signed-in.
  .post(
    "/consume",
    sessionAuthMiddleware(),
    zValidator("json", consumeBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const result = await consumeGroupInvitation(
          { actor: getUserId(c), token: body.token, now: new Date() },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.json(result, 201);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  );
