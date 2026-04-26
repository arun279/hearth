import {
  archiveTrack,
  getTrack,
  pauseTrack,
  resumeTrack,
  saveContributionPolicy,
  saveTrackStructure,
  updateTrackMetadata,
} from "@hearth/core";
import type {
  ContributionPolicyEnvelope,
  LearningTrackId,
  TrackStructureEnvelope,
} from "@hearth/domain";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { getUserId, sessionAuthMiddleware } from "../middleware/session-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

/** Track ids are cuid2 — bound to a length window so a malformed param 400s. */
const trackIdParam = z.object({ trackId: z.string().min(1).max(64) });

const nameField = z.string().trim().min(1).max(120);
const descriptionField = z.string().trim().max(2000);

const patchBody = z
  .object({
    name: nameField.optional(),
    description: z.union([descriptionField, z.null()]).optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: "Provide a name or description to update.",
    path: ["name"],
  });

const statusActionBody = z.object({
  action: z.enum(["pause", "resume", "archive"]),
});

// Track Structure envelope: discriminated union over `mode`. Sections are
// validated structurally (id + title + activityIds[]) so a malformed body is
// 400'd at the boundary, not deep in the adapter.
const trackStructureSection = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  activityIds: z.array(z.string().min(1).max(64)).max(500),
});

const trackStructureEnvelopeBody = z.object({
  v: z.literal(1),
  data: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("free") }),
    z.object({
      mode: z.literal("ordered_sections"),
      sections: z.array(trackStructureSection).max(100),
    }),
  ]),
});

const contributionPolicyEnvelopeBody = z.object({
  v: z.literal(1),
  data: z.object({
    mode: z.enum(["direct", "optional_review", "required_review", "none"]),
  }),
});

function problemFromInvalid(c: Context, error: unknown) {
  return problemResponse(c, problemFromZodError(error as z.ZodError));
}

export const tracksRoutes = new Hono<AppBindings>()
  .use("*", sessionAuthMiddleware())

  // GET /tracks/:trackId — track-home payload (track + group + caps + my enrollment).
  .get(
    "/:trackId",
    zValidator("param", trackIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { trackId } = c.req.valid("param");
      try {
        const result = await getTrack(
          { actor: getUserId(c), trackId: trackId as LearningTrackId },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            tracks: c.var.ports.tracks,
            policy: c.var.ports.policy,
          },
        );
        return c.json(result);
      } catch (err) {
        // canViewTrack denial → DomainError(NOT_FOUND) so the route returns
        // 404, not 403. Existence is not leaked.
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // PATCH /tracks/:trackId — edit name and/or description.
  .patch(
    "/:trackId",
    zValidator("param", trackIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", patchBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { trackId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const track = await updateTrackMetadata(
          {
            actor: getUserId(c),
            trackId: trackId as LearningTrackId,
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            tracks: c.var.ports.tracks,
            policy: c.var.ports.policy,
          },
        );
        return c.json(track);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // POST /tracks/:trackId/status — dispatch on { action }.
  // Single endpoint over three POSTs because the dialog's status radios map
  // 1:1 to one of the three actions; routing them as siblings would let the
  // SPA construct an illegal state machine path on the client.
  .post(
    "/:trackId/status",
    zValidator("param", trackIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", statusActionBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { trackId } = c.req.valid("param");
      const { action } = c.req.valid("json");
      const deps = {
        users: c.var.ports.users,
        groups: c.var.ports.groups,
        tracks: c.var.ports.tracks,
        policy: c.var.ports.policy,
      };
      const input = { actor: getUserId(c), trackId: trackId as LearningTrackId };
      try {
        const track =
          action === "pause"
            ? await pauseTrack(input, deps)
            : action === "resume"
              ? await resumeTrack(input, deps)
              : await archiveTrack(input, deps);
        return c.json(track);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // PUT /tracks/:trackId/structure — replace the structure envelope.
  // The structure + contribution-policy PUT routes are mirror-pair handlers
  // with identical safety shape (validate → call use case → 200/JSON or
  // problem); the use cases themselves are the contract surface that
  // diverges. Flatten the routes once jscpd-ignored than abstract a
  // helper that would obscure which envelope each route owns.
  // jscpd:ignore-start
  .put(
    "/:trackId/structure",
    zValidator("param", trackIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", trackStructureEnvelopeBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { trackId } = c.req.valid("param");
      const envelope = c.req.valid("json") as TrackStructureEnvelope;
      try {
        const track = await saveTrackStructure(
          {
            actor: getUserId(c),
            trackId: trackId as LearningTrackId,
            envelope,
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            tracks: c.var.ports.tracks,
            policy: c.var.ports.policy,
          },
        );
        return c.json(track);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // PUT /tracks/:trackId/contribution-policy — replace the policy envelope.
  .put(
    "/:trackId/contribution-policy",
    zValidator("param", trackIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", contributionPolicyEnvelopeBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { trackId } = c.req.valid("param");
      const envelope = c.req.valid("json") as ContributionPolicyEnvelope;
      try {
        const track = await saveContributionPolicy(
          {
            actor: getUserId(c),
            trackId: trackId as LearningTrackId,
            envelope,
          },
          {
            users: c.var.ports.users,
            groups: c.var.ports.groups,
            tracks: c.var.ports.tracks,
            policy: c.var.ports.policy,
          },
        );
        return c.json(track);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  );
// jscpd:ignore-end
