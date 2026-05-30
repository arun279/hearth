import {
  markActivityComplete,
  resetParticipantProgress,
  savePartProgress,
  setRecordVisibilityOverride,
  startOrResumeActivity,
  submitQuizAnswers,
  viewActivityRecord,
} from "@hearth/core";
import {
  type ActivityPartId,
  type ActivityRecordId,
  type LearningActivityId,
  MAX_ID_LENGTH,
  partProgressStateSchema,
  quizSubmissionSchema,
  type UserId,
} from "@hearth/domain";
import { visibilityPreferenceSchema } from "@hearth/domain/visibility";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { getUserId, sessionAuthMiddleware } from "../middleware/session-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

const activityIdParam = z.object({ activityId: z.string().min(1).max(MAX_ID_LENGTH) });
const activityPartParam = z.object({
  activityId: z.string().min(1).max(MAX_ID_LENGTH),
  partId: z.string().min(1).max(MAX_ID_LENGTH),
});
const activityParticipantParam = z.object({
  activityId: z.string().min(1).max(MAX_ID_LENGTH),
  participantId: z.string().min(1).max(MAX_ID_LENGTH),
});
const recordIdParam = z.object({ recordId: z.string().min(1).max(MAX_ID_LENGTH) });
const historyQuery = z.object({ partId: z.string().min(1).max(MAX_ID_LENGTH).optional() });

const partProgressBody = z.object({ state: partProgressStateSchema });
const visibilityOverrideBody = z.object({ override: visibilityPreferenceSchema.nullable() });

function problemFromInvalid(c: Context, error: unknown) {
  return problemResponse(c, problemFromZodError(error as z.ZodError));
}

function depsFor(c: Context<AppBindings>) {
  return {
    users: c.var.ports.users,
    groups: c.var.ports.groups,
    tracks: c.var.ports.tracks,
    policy: c.var.ports.policy,
    activities: c.var.ports.activities,
    records: c.var.ports.records,
    clock: c.var.ports.clock,
  };
}

export const recordsRoutes = new Hono<AppBindings>()
  .use("*", sessionAuthMiddleware())

  .get(
    "/activities/:activityId/my-record",
    zValidator("param", activityIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId } = c.req.valid("param");
      try {
        const result = await startOrResumeActivity(
          { actor: getUserId(c), activityId: activityId as LearningActivityId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/activities/:activityId/my-record/parts/:partId",
    zValidator("param", activityPartParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", partProgressBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, partId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const result = await savePartProgress(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            partId: partId as ActivityPartId,
            state: body.state,
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
    "/activities/:activityId/my-record/parts/:partId/quiz",
    zValidator("param", activityPartParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", quizSubmissionSchema, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { activityId, partId } = c.req.valid("param");
      const submission = c.req.valid("json");
      try {
        const result = await submitQuizAnswers(
          {
            actor: getUserId(c),
            activityId: activityId as LearningActivityId,
            partId: partId as ActivityPartId,
            submission,
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

  .patch(
    "/records/:recordId/visibility-override",
    zValidator("param", recordIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("json", visibilityOverrideBody, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { recordId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const result = await setRecordVisibilityOverride(
          {
            actor: getUserId(c),
            recordId: recordId as ActivityRecordId,
            override: body.override,
          },
          { users: c.var.ports.users, records: c.var.ports.records, clock: c.var.ports.clock },
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .get(
    "/records/:recordId",
    zValidator("param", recordIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { recordId } = c.req.valid("param");
      try {
        const result = await viewActivityRecord(
          { actor: getUserId(c), recordId: recordId as ActivityRecordId },
          depsFor(c),
        );
        return c.json(result);
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .get(
    "/records/:recordId/history",
    zValidator("param", recordIdParam, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    zValidator("query", historyQuery, (result, c) => {
      if (!result.success) return problemFromInvalid(c, result.error);
    }),
    async (c) => {
      const { recordId } = c.req.valid("param");
      const { partId } = c.req.valid("query");
      try {
        // Gate history behind the same view check the record itself uses, so
        // history never leaks to a non-viewer. `viewActivityRecord` 404s on
        // deny — only an authorized viewer reaches the read below.
        await viewActivityRecord(
          { actor: getUserId(c), recordId: recordId as ActivityRecordId },
          depsFor(c),
        );
        const history = await c.var.ports.records.listPartHistory({
          activityRecordId: recordId as ActivityRecordId,
          partId: partId as ActivityPartId | undefined,
        });
        return c.json({ history });
      } catch (err) {
        return problemResponse(c, mapUnknown(err));
      }
    },
  )

  .post(
    "/activities/:activityId/participants/:participantId/reset",
    zValidator("param", activityParticipantParam, (result, c) => {
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
  );
