import {
  archiveGroup,
  createGroupInvitation,
  createStudyGroup,
  finalizeAvatarUpload,
  getGroup,
  leaveGroup,
  listGroupInvitations,
  listGroupMembers,
  listMyGroups,
  removeGroupMember,
  requestAvatarUpload,
  revokeGroupInvitation,
  setGroupAdmin,
  unarchiveGroup,
  updateGroupMetadata,
  updateGroupProfile,
} from "@hearth/core";
import type {
  GroupRole,
  InvitationId,
  LearningTrackId,
  StudyGroupId,
  UserId,
} from "@hearth/domain";
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

const userIdParam = z.object({
  groupId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
});

const invitationIdParam = z.object({
  groupId: z.string().min(1).max(64),
  invitationId: z.string().min(1).max(64),
});

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .pipe(z.email())
  .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: "Email must include a domain." });

const attributionField = z.enum(["preserve_name", "anonymize"]);

const leaveBody = z.object({ attribution: attributionField.optional() }).optional();

const setRoleBody = z.object({ role: z.enum(["participant", "admin"]) });

const updateProfileBody = z
  .object({
    nickname: z.union([z.string().trim().min(1).max(60), z.null()]).optional(),
    bio: z.union([z.string().max(800), z.null()]).optional(),
  })
  .refine((v) => v.nickname !== undefined || v.bio !== undefined, {
    message: "Provide a nickname or bio to update.",
    path: ["nickname"],
  });

const createInvitationBody = z.object({
  email: emailField.optional(),
  trackId: z.string().min(1).max(64).optional(),
});

const avatarMimeField = z.enum(["image/png", "image/jpeg", "image/webp"]);

const requestAvatarBody = z.object({
  mimeType: avatarMimeField,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024),
});

const finalizeAvatarBody = z.object({
  uploadId: z.string().min(1).max(64),
});

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
  )
  // jscpd:ignore-end

  // ── Memberships ───────────────────────────────────────────────────────

  // GET /g/:groupId/members — list active members + per-row capabilities.
  .get(
    "/:groupId/members",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      try {
        const result = await listGroupMembers(
          { actor: getUserId(c), groupId: groupId as StudyGroupId },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // DELETE /g/:groupId/members/:userId — remove someone else.
  .delete(
    "/:groupId/members/:userId",
    zValidator("param", userIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId, userId } = c.req.valid("param");
      try {
        await removeGroupMember(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            target: userId as UserId,
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            tracks: c.var.ports.tracks,
            policy: c.var.ports.policy,
          },
        );
        return c.body(null, 204);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // PATCH /g/:groupId/members/:userId/role — promote / demote.
  .patch(
    "/:groupId/members/:userId/role",
    zValidator("param", userIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", setRoleBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId, userId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const membership = await setGroupAdmin(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            target: userId as UserId,
            role: body.role as GroupRole,
          },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.json(membership);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // PATCH /g/:groupId/members/:userId/profile — self-edit nickname/bio.
  .patch(
    "/:groupId/members/:userId/profile",
    zValidator("param", userIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", updateProfileBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId, userId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const membership = await updateGroupProfile(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            target: userId as UserId,
            patch: body,
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            storage: c.var.ports.storage,
          },
        );
        return c.json(membership);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // POST /g/:groupId/leave — self-leave.
  .post(
    "/:groupId/leave",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", leaveBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        await leaveGroup(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            ...(body?.attribution !== undefined ? { attribution: body.attribution } : {}),
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            tracks: c.var.ports.tracks,
            policy: c.var.ports.policy,
          },
        );
        return c.body(null, 204);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // ── Invitations ───────────────────────────────────────────────────────

  // GET /g/:groupId/invitations — admin-only outstanding list.
  .get(
    "/:groupId/invitations",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      try {
        const entries = await listGroupInvitations(
          { actor: getUserId(c), groupId: groupId as StudyGroupId, now: new Date() },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.json({ entries });
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // POST /g/:groupId/invitations — mint a new invitation.
  .post(
    "/:groupId/invitations",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", createInvitationBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const result = await createGroupInvitation(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            trackId: (body.trackId ?? null) as LearningTrackId | null,
            email: body.email ?? null,
            now: new Date(),
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            ids: c.var.ports.ids,
          },
        );
        return c.json(result, 201);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // DELETE /g/:groupId/invitations/:invitationId — revoke an invitation.
  .delete(
    "/:groupId/invitations/:invitationId",
    zValidator("param", invitationIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId, invitationId } = c.req.valid("param");
      try {
        await revokeGroupInvitation(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            invitationId: invitationId as InvitationId,
            now: new Date(),
          },
          { users: c.var.ports.users, groups: c.var.ports.groups, policy: c.var.ports.policy },
        );
        return c.body(null, 204);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // ── Avatars ───────────────────────────────────────────────────────────

  // POST /g/:groupId/avatar/upload-request — mint presigned PUT URL.
  .post(
    "/:groupId/avatar/upload-request",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", requestAvatarBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { groupId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const result = await requestAvatarUpload(
          {
            actor: getUserId(c),
            groupId: groupId as StudyGroupId,
            mimeType: body.mimeType,
            sizeBytes: body.sizeBytes,
            now: new Date(),
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            storage: c.var.ports.storage,
            uploads: c.var.ports.uploads,
            ids: c.var.ports.ids,
          },
        );
        return c.json(result, 201);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // POST /g/:groupId/avatar/finalize — finalize the upload.
  .post(
    "/:groupId/avatar/finalize",
    zValidator("param", groupIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", finalizeAvatarBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const membership = await finalizeAvatarUpload(
          { actor: getUserId(c), uploadId: body.uploadId },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            storage: c.var.ports.storage,
            uploads: c.var.ports.uploads,
          },
        );
        return c.json(membership);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  );
