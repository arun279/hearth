import { MAX_ID_LENGTH } from "@hearth/domain";
import type { Context } from "hono";
import { z } from "zod";
import { problemFromZodError, problemResponse } from "../problem.ts";

const idField = z.string().min(1).max(MAX_ID_LENGTH);

/** `{ activityId }` path param, shared across the activity + record routes. */
export const activityIdParam = z.object({ activityId: idField });
/** `{ activityId, partId }` path param. */
export const activityPartParam = z.object({ activityId: idField, partId: idField });
/** `{ activityId, participantId }` path param. */
export const activityParticipantParam = z.object({ activityId: idField, participantId: idField });

/** Map a failed `zValidator` parse to the RFC 7807 422 body. */
export function problemFromInvalid(c: Context, error: unknown) {
  return problemResponse(c, problemFromZodError(error as z.ZodError));
}
