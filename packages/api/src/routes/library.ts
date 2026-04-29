import {
  addLibrarySteward,
  finalizeLibraryUpload,
  getLibraryItem,
  removeLibrarySteward,
  retireLibraryItem,
  updateLibraryMetadata,
} from "@hearth/core";
import {
  ALLOWED_LIBRARY_MIME_TYPES,
  type LibraryItemId,
  MAX_LIBRARY_ITEM_BYTES,
  MAX_TAG_CHARS,
  MAX_TAGS,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { getUserId, sessionAuthMiddleware } from "../middleware/session-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

const itemIdParam = z.object({ itemId: z.string().min(1).max(64) });
const revisionIdParam = z.object({
  itemId: z.string().min(1).max(64),
  revisionId: z.string().min(1).max(64),
});
const stewardUserIdParam = z.object({
  itemId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
});

const titleField = z.string().trim().min(1).max(200);
const descriptionField = z.string().trim().max(4000);
const tagField = z.string().trim().min(1).max(MAX_TAG_CHARS);
// Cap matches the domain's `MAX_TAGS`. Without this the route accepts more
// than the domain ultimately keeps after `normalizeTags()`, so the silent
// trim happens server-side and the user never learns their excess tags
// were dropped.
const tagsField = z.array(tagField).max(MAX_TAGS);

// MIME allowlist replicated as a Zod literal-union so a bogus value 400s
// at the boundary with a precise error path. The use case still re-checks
// `isAllowedLibraryMime` defensively so a non-route caller can't bypass
// the rule, but in practice the route validation is the only path that
// reaches `requestLibraryUpload` from the API surface.
const libraryMimeField = z.enum(ALLOWED_LIBRARY_MIME_TYPES as readonly [string, ...string[]]);

export const libraryRequestUploadBody = z.object({
  mimeType: libraryMimeField,
  sizeBytes: z.number().int().positive().max(MAX_LIBRARY_ITEM_BYTES),
  originalFilename: z.string().trim().min(1).max(260).nullable().optional(),
  libraryItemId: z.string().min(1).max(64).optional(),
});

const finalizeBody = z.object({
  uploadId: z.string().min(1).max(64),
  groupId: z.string().min(1).max(64),
  title: titleField,
  description: z.union([descriptionField, z.null()]).optional(),
  tags: tagsField.optional(),
});

const updateMetadataBody = z
  .object({
    title: titleField.optional(),
    description: z.union([descriptionField, z.null()]).optional(),
    tags: tagsField.optional(),
  })
  .refine(
    (body) => body.title !== undefined || body.description !== undefined || body.tags !== undefined,
    { message: "Provide title, description, or tags to update.", path: ["title"] },
  );

const addStewardBody = z.object({
  userId: z.string().min(1).max(64),
});

function problemFromInvalid(c: Context, error: unknown) {
  return problemResponse(c, problemFromZodError(error as z.ZodError));
}

/**
 * Signed-GET lifetime for download redirects. 300 seconds = 5 minutes —
 * long enough for a browser to follow the 302 + start the download,
 * short enough that a screenshot or copy-paste of the URL stops working
 * before it's useful for sharing. Each click on Download mints a fresh
 * URL via the API, so a casual user never sees the URL itself.
 */
const DOWNLOAD_TTL_SECONDS = 300;

function sanitizeFilename(name: string): string {
  return name.replace(/"/g, "");
}

/**
 * Sign a short-lived GET URL for a single R2 object and 302-redirect to
 * it. Both the current-revision and revisions-by-id download routes
 * funnel through this helper — same TTL, same Content-Disposition shape,
 * one place to change.
 */
async function signedRedirect(
  c: Context<AppBindings>,
  storageKey: string,
  filename: string,
): Promise<Response> {
  const safe = sanitizeFilename(filename);
  const url = await c.var.ports.storage.getDownloadUrl({
    key: storageKey,
    ttlSeconds: DOWNLOAD_TTL_SECONDS,
    contentDisposition: `attachment; filename="${safe}"`,
  });
  return c.redirect(url, 302);
}

/**
 * Load `getLibraryItem` for a route. Centralizes the deps wiring + the
 * `actor` plumbing so the three /:itemId-rooted handlers don't each
 * reproduce the seven-line boilerplate.
 */
function loadItemForRoute(c: Context<AppBindings>, itemId: LibraryItemId) {
  return getLibraryItem(
    { actor: getUserId(c), itemId },
    {
      users: c.var.ports.users,
      groups: c.var.ports.groups,
      policy: c.var.ports.policy,
      library: c.var.ports.libraryItems,
    },
  );
}

/**
 * Routes mounted at `/api/v1/library/*` — the per-item surface. The
 * group-scoped list + upload-request live inside `groupsRoutes` (their
 * URL embeds `:groupId`); putting them here would mean a second mount
 * with `/g/:groupId/...` overrides.
 */
export const libraryRoutes = new Hono<AppBindings>()
  .use("*", sessionAuthMiddleware())

  .get(
    "/:itemId",
    zValidator("param", itemIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { itemId } = c.req.valid("param");
      try {
        const result = await loadItemForRoute(c, itemId as LibraryItemId);
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .get(
    "/:itemId/download",
    zValidator("param", itemIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { itemId } = c.req.valid("param");
      try {
        const result = await loadItemForRoute(c, itemId as LibraryItemId);
        const current = result.detail.revisions.find(
          (r) => r.id === result.detail.item.currentRevisionId,
        );
        if (!current) {
          return problemResponse(c, {
            type: "about:blank#no_current_revision",
            title: "no current revision",
            status: 404,
            detail: "Item has no current revision.",
            code: "no_current_revision",
          });
        }
        return await signedRedirect(
          c,
          current.storageKey,
          current.originalFilename ?? `${result.detail.item.title}.${current.id}`,
        );
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .get(
    "/:itemId/revisions/:revisionId/download",
    zValidator("param", revisionIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { itemId, revisionId } = c.req.valid("param");
      try {
        const result = await loadItemForRoute(c, itemId as LibraryItemId);
        const revision = result.detail.revisions.find((r) => r.id === revisionId);
        if (!revision) {
          return problemResponse(c, {
            type: "about:blank#not_found",
            title: "not found",
            status: 404,
            detail: "Revision not found.",
            code: "not_found",
          });
        }
        return await signedRedirect(
          c,
          revision.storageKey,
          revision.originalFilename ?? `${result.detail.item.title}.r${revision.revisionNumber}`,
        );
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/finalize",
    zValidator("json", finalizeBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const detail = await finalizeLibraryUpload(
          {
            actor: getUserId(c),
            groupId: body.groupId as StudyGroupId,
            uploadId: body.uploadId,
            title: body.title,
            description: body.description ?? null,
            tags: body.tags ?? [],
            now: new Date(),
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            library: c.var.ports.libraryItems,
            storage: c.var.ports.storage,
            uploads: c.var.ports.uploads,
          },
        );
        return c.json(detail, 201);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .patch(
    "/:itemId",
    zValidator("param", itemIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", updateMetadataBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { itemId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const item = await updateLibraryMetadata(
          {
            actor: getUserId(c),
            itemId: itemId as LibraryItemId,
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.tags !== undefined ? { tags: body.tags } : {}),
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            library: c.var.ports.libraryItems,
          },
        );
        return c.json(item);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/:itemId/retire",
    zValidator("param", itemIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { itemId } = c.req.valid("param");
      try {
        const item = await retireLibraryItem(
          { actor: getUserId(c), itemId: itemId as LibraryItemId, now: new Date() },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            library: c.var.ports.libraryItems,
          },
        );
        return c.json(item);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/:itemId/stewards",
    zValidator("param", itemIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", addStewardBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { itemId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const stewardship = await addLibrarySteward(
          {
            actor: getUserId(c),
            itemId: itemId as LibraryItemId,
            userId: body.userId as UserId,
            now: new Date(),
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            library: c.var.ports.libraryItems,
          },
        );
        if (stewardship === null) {
          return c.json({ created: false }, 200);
        }
        return c.json({ created: true, stewardship }, 201);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .delete(
    "/:itemId/stewards/:userId",
    zValidator("param", stewardUserIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { itemId, userId } = c.req.valid("param");
      try {
        await removeLibrarySteward(
          {
            actor: getUserId(c),
            itemId: itemId as LibraryItemId,
            userId: userId as UserId,
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            policy: c.var.ports.policy,
            library: c.var.ports.libraryItems,
          },
        );
        return c.body(null, 204);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  );
