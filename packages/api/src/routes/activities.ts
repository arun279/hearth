import {
  createActivity,
  deleteActivity,
  getActivity,
  getActivityForPlayer,
  getMyActivityRecord,
  gradeQuizAnswers,
  listActivityParticipantRecords,
  listMyPartHistory,
  listPartHistory,
  listTrackActivities,
  markActivityComplete,
  pinLibraryRevision,
  resetParticipantProgress,
  saveReflectionDraft,
  setActivityLibraryRefs,
  setActivityPrerequisites,
  setActivitySuggestedSequences,
  setPartCompleted,
  setRecordVisibilityOverride,
  submitQuizAnswers,
  unpinLibraryRevision,
  updateActivity,
  viewActivityRecord,
} from "@hearth/core";
import {
  type ActivityAudience,
  type ActivityPartId,
  type ActivityRecordId,
  activityPartSchema,
  audienceEnvelopeSchema,
  completionRuleEnvelopeSchema,
  flowEnvelopeSchema,
  type LearningActivityId,
  type LearningTrackId,
  MAX_CROSS_ACTIVITY_EDGES,
  MAX_ID_LENGTH,
  MAX_LIBRARY_REFS_PER_ACTIVITY,
  MAX_LONG_TEXT_LENGTH,
  MAX_PARTS_PER_ACTIVITY,
  MAX_QUIZ_QUESTIONS,
  MAX_REFLECTION_LENGTH,
  MAX_TITLE_LENGTH,
  postClosePolicyEnvelopeSchema,
  quizAnswerSchema,
  type UserId,
  visibilityPreferenceSchema,
  windowEnvelopeSchema,
} from "@hearth/domain";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { getUserId, sessionAuthMiddleware } from "../middleware/session-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

const activityIdParam = z.object({ activityId: z.string().min(1).max(MAX_ID_LENGTH) });
const trackIdParam = z.object({ trackId: z.string().min(1).max(MAX_ID_LENGTH) });
const activityItemParam = z.object({
  activityId: z.string().min(1).max(MAX_ID_LENGTH),
  itemId: z.string().min(1).max(MAX_ID_LENGTH),
});
const activityPartParam = z.object({
  activityId: z.string().min(1).max(MAX_ID_LENGTH),
  partId: z.string().min(1).max(MAX_ID_LENGTH),
});
const recordIdParam = z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) });
const participantResetParam = z.object({
  activityId: z.string().min(1).max(MAX_ID_LENGTH),
  participantId: z.string().min(1).max(MAX_ID_LENGTH),
});
const historyQuery = z.object({
  partId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
});

const reflectionBody = z.object({ text: z.string().max(MAX_REFLECTION_LENGTH) });
const quizSubmitBody = z.object({
  answers: z.array(quizAnswerSchema).max(MAX_QUIZ_QUESTIONS),
});
const completionBody = z.object({ completed: z.boolean() });
const visibilityOverrideBody = z.object({ preference: visibilityPreferenceSchema.nullable() });

const titleField = z.string().trim().min(1).max(MAX_TITLE_LENGTH);
const descriptionField = z.union([z.string().trim().max(MAX_LONG_TEXT_LENGTH), z.null()]);
const learningActivityIdField = z.string().min(1).max(MAX_ID_LENGTH);

/**
 * Composer payload — matches `LearningActivityDraft` from `@hearth/domain`.
 * The Zod fragments below reuse the same envelope-data shapes the adapter
 * stores, so the wire contract and the storage shape never drift.
 */
const composerBody = z.object({
  trackId: learningActivityIdField,
  title: titleField,
  description: descriptionField.optional(),
  parts: z.array(activityPartSchema).max(MAX_PARTS_PER_ACTIVITY),
  flow: flowEnvelopeSchema.shape.data,
  audience: audienceEnvelopeSchema.shape.data,
  window: z.union([windowEnvelopeSchema.shape.data, z.null()]).optional(),
  postClosePolicy: z.union([postClosePolicyEnvelopeSchema.shape.data, z.null()]).optional(),
  completionRule: completionRuleEnvelopeSchema.shape.data,
  libraryRefs: z
    .array(
      z.object({
        libraryItemId: learningActivityIdField,
        pinnedRevisionId: z.union([z.string().min(1).max(MAX_ID_LENGTH), z.null()]).optional(),
      }),
    )
    .max(MAX_LIBRARY_REFS_PER_ACTIVITY),
  prerequisiteActivityIds: z.array(learningActivityIdField).max(MAX_CROSS_ACTIVITY_EDGES),
  suggestedNextActivityIds: z.array(learningActivityIdField).max(MAX_CROSS_ACTIVITY_EDGES),
});

/**
 * Partial-update body for `PUT /activities/:id`. Mirrors `composerBody`
 * minus `trackId` (immutable post-create — moving an activity to a
 * different track is not a v1 operation). Each field is independently
 * optional so the SPA can patch any subset; the use case orchestrates
 * the body update and the three children writes (library refs,
 * prerequisites, suggested-sequences) atomically per call.
 */
const updateBody = composerBody.omit({ trackId: true }).partial();

const refsBody = z.object({
  refs: z
    .array(
      z.object({
        libraryItemId: learningActivityIdField,
        pinnedRevisionId: z.union([z.string().min(1).max(MAX_ID_LENGTH), z.null()]).optional(),
      }),
    )
    .max(MAX_LIBRARY_REFS_PER_ACTIVITY),
});

const pinBody = z.object({
  revisionId: z.string().min(1).max(MAX_ID_LENGTH),
});

const prerequisitesBody = z.object({
  prerequisiteActivityIds: z.array(learningActivityIdField).max(MAX_CROSS_ACTIVITY_EDGES),
});

const suggestedBody = z.object({
  nextActivityIds: z.array(learningActivityIdField).max(MAX_CROSS_ACTIVITY_EDGES),
});

function problemFromInvalid(c: Context, error: unknown) {
  return problemResponse(c, problemFromZodError(error as z.ZodError));
}

function depsFor(c: Context<AppBindings>) {
  return {
    users: c.var.ports.users,
    groups: c.var.ports.groups,
    tracks: c.var.ports.tracks,
    policy: c.var.ports.policy,
    library: c.var.ports.libraryItems,
    activities: c.var.ports.activities,
    records: c.var.ports.records,
    storage: c.var.ports.storage,
    clock: c.var.ports.clock,
  };
}

/**
 * Wire-shape for `audience` and library-ref `pinnedRevisionId`: the Zod
 * `.optional()` produces `field?: T | undefined`, but the use case
 * draft type expects `field: T | null`. Normalize at the boundary so
 * downstream code never sees `undefined`.
 */
function normalizePinned(value: string | null | undefined): string | null {
  return value ?? null;
}

function normalizeWindow(value: z.infer<typeof composerBody>["window"]) {
  return value ?? null;
}

function normalizePostClose(value: z.infer<typeof composerBody>["postClosePolicy"]) {
  return value ?? null;
}

/**
 * Promote validated string ids to their branded domain types at the
 * route boundary. Zod's `string()` schemas erase to plain strings;
 * the domain layer carries `UserId` / `LearningActivityId` brands so
 * cross-aggregate id confusion is a type error. Per-element `.map`
 * with an explicit return-type annotation reads as the localized
 * promotion it is — no `as unknown as` double cast needed.
 */
function normalizeAudience(value: z.infer<typeof composerBody>["audience"]): ActivityAudience {
  if (value.kind === "subset") {
    return { kind: "subset", userIds: value.userIds.map((id): UserId => id as UserId) };
  }
  return { kind: "everyone_enrolled" };
}

function brandActivityIds(ids: readonly string[]): readonly LearningActivityId[] {
  return ids.map((id): LearningActivityId => id as LearningActivityId);
}

export const activitiesRoutes = new Hono<AppBindings>()
  .use("*", sessionAuthMiddleware())

  .get(
    "/tracks/:trackId/activities",
    zValidator("param", trackIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { trackId } = c.req.valid("param");
      try {
        const result = await listTrackActivities(
          { actor: getUserId(c), trackId: trackId as LearningTrackId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/tracks/:trackId/activities",
    zValidator("param", trackIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", composerBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { trackId } = c.req.valid("param");
      const body = c.req.valid("json");
      if (body.trackId !== trackId) {
        return problemResponse(c, {
          type: "about:blank#trackId_mismatch",
          title: "trackId mismatch",
          status: 400,
          detail: "Body trackId does not match URL trackId.",
          code: "validation_error",
        });
      }
      try {
        const result = await createActivity(
          {
            actor: getUserId(c),
            draft: {
              trackId: body.trackId as LearningTrackId,
              title: body.title,
              description: body.description ?? null,
              parts: body.parts,
              flow: body.flow,
              audience: normalizeAudience(body.audience),
              window: normalizeWindow(body.window),
              postClosePolicy: normalizePostClose(body.postClosePolicy),
              completionRule: body.completionRule,
              libraryRefs: body.libraryRefs.map((r) => ({
                libraryItemId: r.libraryItemId,
                pinnedRevisionId: normalizePinned(r.pinnedRevisionId),
              })),
              prerequisiteActivityIds: brandActivityIds(body.prerequisiteActivityIds),
              suggestedNextActivityIds: brandActivityIds(body.suggestedNextActivityIds),
            },
          },
          depsFor(c),
        );
        return c.json(result, 201);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .get(
    "/activities/:activityId",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      try {
        const result = await getActivity(
          { actor: getUserId(c), id: activityId as LearningActivityId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  /**
   * Composer-faced `/activities/:id` returns the authoring shape. The
   * `/player` projection adds resolved library URLs, the viewer's
   * enrollment status, and a window-aware `accessState` so the player
   * chrome renders pre-open / locked banners without a second fetch. A
   * subset-audience viewer who isn't listed (and any non-member) gets
   * the same 404 a non-existent activity returns — the audience set is
   * not enumerable by trial.
   */
  .get(
    "/activities/:activityId/player",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      try {
        const result = await getActivityForPlayer(
          { actor: getUserId(c), id: activityId as LearningActivityId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .put(
    "/activities/:activityId",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", updateBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const result = await updateActivity(
          {
            actor: getUserId(c),
            id: activityId as LearningActivityId,
            patch: {
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.parts !== undefined ? { parts: body.parts } : {}),
              ...(body.flow !== undefined ? { flow: body.flow } : {}),
              ...(body.audience !== undefined
                ? { audience: normalizeAudience(body.audience) }
                : {}),
              ...(body.window !== undefined ? { window: normalizeWindow(body.window) } : {}),
              ...(body.postClosePolicy !== undefined
                ? { postClosePolicy: normalizePostClose(body.postClosePolicy) }
                : {}),
              ...(body.completionRule !== undefined ? { completionRule: body.completionRule } : {}),
              ...(body.libraryRefs !== undefined
                ? {
                    libraryRefs: body.libraryRefs.map((r) => ({
                      libraryItemId: r.libraryItemId,
                      pinnedRevisionId: normalizePinned(r.pinnedRevisionId),
                    })),
                  }
                : {}),
              ...(body.prerequisiteActivityIds !== undefined
                ? { prerequisiteActivityIds: brandActivityIds(body.prerequisiteActivityIds) }
                : {}),
              ...(body.suggestedNextActivityIds !== undefined
                ? { suggestedNextActivityIds: brandActivityIds(body.suggestedNextActivityIds) }
                : {}),
            },
          },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .delete(
    "/activities/:activityId",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      try {
        await deleteActivity(
          { actor: getUserId(c), id: activityId as LearningActivityId },
          depsFor(c),
        );
        return c.body(null, 204);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .put(
    "/activities/:activityId/library-refs",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", refsBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const refs = await setActivityLibraryRefs(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            refs: body.refs.map((r) => ({
              libraryItemId: r.libraryItemId,
              pinnedRevisionId: normalizePinned(r.pinnedRevisionId),
            })),
          },
          depsFor(c),
        );
        return c.json({ refs });
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/activities/:activityId/library-refs/:itemId/pin",
    zValidator("param", activityItemParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", pinBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, itemId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const refs = await pinLibraryRevision(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            libraryItemId: itemId,
            revisionId: body.revisionId,
          },
          depsFor(c),
        );
        return c.json({ refs });
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .delete(
    "/activities/:activityId/library-refs/:itemId/pin",
    zValidator("param", activityItemParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, itemId } = c.req.valid("param");
      try {
        const refs = await unpinLibraryRevision(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            libraryItemId: itemId,
          },
          depsFor(c),
        );
        return c.json({ refs });
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .put(
    "/activities/:activityId/prerequisites",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", prerequisitesBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const ids = await setActivityPrerequisites(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            prerequisiteActivityIds: brandActivityIds(body.prerequisiteActivityIds),
          },
          depsFor(c),
        );
        return c.json({ prerequisiteActivityIds: ids });
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .put(
    "/activities/:activityId/suggested-sequences",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", suggestedBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const ids = await setActivitySuggestedSequences(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            nextActivityIds: brandActivityIds(body.nextActivityIds),
          },
          depsFor(c),
        );
        return c.json({ nextActivityIds: ids });
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // A participant's own Activity Record, mounted here (not a separate
  // router) so it shares the single "/"-mounted session-auth setup. The
  // GET never creates a row — the record is created lazily on first write,
  // keeping reads safe under the killswitch's read-only mode.
  .get(
    "/activities/:activityId/my-record",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      try {
        const result = await getMyActivityRecord(
          { actor: getUserId(c), activityId: activityId as LearningActivityId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .put(
    "/activities/:activityId/my-record/parts/:partId/reflection",
    zValidator("param", activityPartParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", reflectionBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, partId } = c.req.valid("param");
      const { text } = c.req.valid("json");
      try {
        const result = await saveReflectionDraft(
          { actor: getUserId(c), activityId: activityId as LearningActivityId, partId, text },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .put(
    "/activities/:activityId/my-record/parts/:partId/quiz",
    zValidator("param", activityPartParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", quizSubmitBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, partId } = c.req.valid("param");
      const { answers } = c.req.valid("json");
      try {
        const result = await submitQuizAnswers(
          { actor: getUserId(c), activityId: activityId as LearningActivityId, partId, answers },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .put(
    "/activities/:activityId/my-record/parts/:partId/completion",
    zValidator("param", activityPartParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", completionBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, partId } = c.req.valid("param");
      const { completed } = c.req.valid("json");
      try {
        const result = await setPartCompleted(
          { actor: getUserId(c), activityId: activityId as LearningActivityId, partId, completed },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .patch(
    "/activities/:activityId/my-record/visibility-override",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", visibilityOverrideBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      const { preference } = c.req.valid("json");
      try {
        const result = await setRecordVisibilityOverride(
          { actor: getUserId(c), activityId: activityId as LearningActivityId, preference },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // Mount-time quiz re-grade: a READ that re-derives the per-question
  // verdict + score from the persisted answers so a refreshed Player can
  // show the grade again without re-submitting. No write — re-grading on
  // every mount must not consume a D1 write (the ≤ 50-writes/user/day
  // budget behind the $0 guarantee). `null` when nothing is stored yet.
  .get(
    "/activities/:activityId/my-record/parts/:partId/quiz",
    zValidator("param", activityPartParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, partId } = c.req.valid("param");
      try {
        const result = await gradeQuizAnswers(
          { actor: getUserId(c), activityId: activityId as LearningActivityId, partId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // Owner-addressed Part History read — mirrors the own-record WRITE
  // addressing (activity id + my-record, never the record id) so the
  // <PartHistoryDrawer> reaches the owner's history without exposing the
  // record id the lean own-record path hides. The record is resolved
  // internally; an owner with no record yet gets [].
  .get(
    "/activities/:activityId/my-record/history",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("query", historyQuery, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      const { partId } = c.req.valid("query");
      try {
        const result = await listMyPartHistory(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            ...(partId !== undefined ? { partId: partId as ActivityPartId } : {}),
          },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/activities/:activityId/my-record/complete",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      try {
        const result = await markActivityComplete(
          { actor: getUserId(c), activityId: activityId as LearningActivityId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // Facilitator roster: the activity's participant records (display name +
  // completion state + history count) the reset affordance is driven from.
  // Track-Facilitator / Group-Admin only — the same authority that gates the
  // reset, so a row is never shown to someone who couldn't act on it.
  // Viewability runs first (404 a non-viewer), then authority (403).
  .get(
    "/activities/:activityId/participants",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      try {
        const result = await listActivityParticipantRecords(
          { actor: getUserId(c), activityId: activityId as LearningActivityId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // Facilitator reset, addressed by activity + participant (not record id,
  // which the facilitator never holds). Destructive in a non-obvious way —
  // the participant keeps their work as Part History. Returns the now-reset
  // full view so the facilitator's surface updates without a refetch.
  .post(
    "/activities/:activityId/participants/:participantId/reset",
    zValidator("param", participantResetParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, participantId } = c.req.valid("param");
      try {
        const result = await resetParticipantProgress(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            participantId: participantId as UserId,
          },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  // recordId-addressed cross-participant reads. Viewability runs first and
  // surfaces a view-denial as 404 (not 403) so a non-participant probing a
  // record id cannot tell "exists but forbidden" from "does not exist" —
  // the record id is otherwise an enumeration oracle over a hideable
  // resource. M11 grants only the participant themselves (`scope = full`).
  .get(
    "/records/:id",
    zValidator("param", recordIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      try {
        const result = await viewActivityRecord(
          { actor: getUserId(c), recordId: id as ActivityRecordId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .get(
    "/records/:id/history",
    zValidator("param", recordIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("query", historyQuery, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { partId } = c.req.valid("query");
      try {
        const result = await listPartHistory(
          {
            actor: getUserId(c),
            recordId: id as ActivityRecordId,
            ...(partId !== undefined ? { partId: partId as ActivityPartId } : {}),
          },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  );
