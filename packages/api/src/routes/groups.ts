import {
  archiveGroup,
  createStudyGroup,
  getGroup,
  listMyGroups,
  unarchiveGroup,
  updateGroupMetadata,
} from "@hearth/core";
import type { StudyGroupId } from "@hearth/domain";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { getUserId, sessionAuthMiddleware } from "../middleware/session-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

/**
 * Group ids are cuid2 — short, URL-safe, no separators. Bound the field so a
 * malformed path parameter produces a 400 with a stable code instead of a
 * 404 mid-handler.
 */
const groupIdParam = z.object({ groupId: z.string().min(1).max(64) });

const nameField = z.string().trim().min(1).max(120);
const descriptionField = z.string().trim().max(2000);

const createBody = z.object({
  name: nameField,
  description: descriptionField.optional(),
});

const patchBody = z
  .object({
    name: nameField.optional(),
    description: z.union([descriptionField, z.null()]).optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: "Provide a name or description to update.",
    path: ["name"],
  });

/**
 * Convert a zValidator schema-failure into our RFC 7807 envelope. The
 * runtime `error` is a Zod `$ZodError` instance whose `.issues` field
 * matches Zod 4's `ZodError<T>` consumer surface even though the static
 * types declared by `@hono/zod-validator` don't. We cast through `unknown`
 * at the boundary.
 *
 * Note: Hono's underlying `validator("json", …)` short-circuits a malformed
 * JSON body with a plain `text("Malformed JSON…", 400)` BEFORE this hook
 * runs, so this hook only sees schema failures, never parse failures.
 *
 * Hono's middleware callbacks pass a generic `Context<Env>`; we type the
 * parameter loosely so the callback site stays inference-friendly.
 */
function problemFromInvalid(c: Context, error: unknown) {
  return problemResponse(c, problemFromZodError(error as z.ZodError));
}

export const groupsRoutes = new Hono<AppBindings>()
  .use("*", sessionAuthMiddleware())

  // POST /g — create a Study Group (Instance Operator only).
  .post(
    "/",
    zValidator("json", createBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const group = await createStudyGroup(
          { actor: getUserId(c), name: body.name, description: body.description },
          {
            users: c.var.ports.users,
            policy: c.var.ports.policy,
            groups: c.var.ports.groups,
          },
        );
        return c.json(group, 201);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // GET /g — list groups the actor is a member of.
  .get("/", async (c) => {
    try {
      const groups = await listMyGroups({ actor: getUserId(c) }, { groups: c.var.ports.groups });
      return c.json({ entries: groups });
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })

  // GET /g/:groupId — group home payload (group + caps + counts + my membership).
  .get(
    "/:groupId",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      try {
        const result = await getGroup(
          { actor: getUserId(c), groupId: groupId as StudyGroupId },
          {
            users: c.var.ports.users,
            policy: c.var.ports.policy,
            groups: c.var.ports.groups,
          },
        );
        return c.json(result);
      } catch (err) {
        // canViewGroup denial → DomainError(NOT_FOUND, "not_group_member") so
        // the route returns 404, not 403. Existence is not leaked.
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // PATCH /g/:groupId — edit name/description (Group Admin only; archived = 403).
  .patch(
    "/:groupId",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", patchBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const group = await updateGroupMetadata(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
          },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.json(group);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // Archive + unarchive are mirror-pair routes by design — flatten the
  // structure once jscpd-ignored than abstract a one-string-difference helper.
  // jscpd:ignore-start
  .post(
    "/:groupId/archive",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      try {
        await archiveGroup(
          { actor: getUserId(c), groupId: groupId as StudyGroupId },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.body(null, 204);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )
  .post(
    "/:groupId/unarchive",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      try {
        await unarchiveGroup(
          { actor: getUserId(c), groupId: groupId as StudyGroupId },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.body(null, 204);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  );
// jscpd:ignore-end
