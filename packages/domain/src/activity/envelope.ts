import { z } from "zod";
import { activityPartSchema } from "../parts/index.ts";
import { MAX_AUDIENCE_USER_IDS, MAX_ID_LENGTH, MAX_PARTS_PER_ACTIVITY } from "./_limits.ts";

const partIdRef = z.string().min(1).max(MAX_ID_LENGTH);
const userIdField = z.string().min(1).max(MAX_ID_LENGTH);

/**
 * Versioned envelopes per the relational-schema convention. The `v: 1`
 * literal is the load-bearing discriminator: future shape changes bump
 * `v` and add a read-time shim against the prior version's fixtures.
 *
 * The schemas below are the wire contract — the same instances run on
 * the API server (validating request bodies inside `react-hook-form`'s
 * Zod resolver runs and the route's `zValidator`) AND on the adapter
 * read-side (defense-in-depth re-parse before persisting). One source
 * of truth, no drift.
 */

export const partsEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.array(activityPartSchema).max(MAX_PARTS_PER_ACTIVITY),
});
export type PartsEnvelope = z.infer<typeof partsEnvelopeSchema>;

// Edge cap. Sized at the worst case `MAX_PARTS_PER_ACTIVITY^2 / N` for a
// reasonable max in-degree; in practice authors stay far below this.
const MAX_INTRA_ACTIVITY_FLOW_EDGES = MAX_PARTS_PER_ACTIVITY * 10;

export const flowEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.object({
    prereqs: z
      .array(
        z.object({
          fromPartId: partIdRef,
          toPartId: partIdRef,
          kind: z.enum(["hard", "soft"]),
        }),
      )
      .max(MAX_INTRA_ACTIVITY_FLOW_EDGES),
    displayOrder: z.array(partIdRef).max(MAX_PARTS_PER_ACTIVITY).optional(),
  }),
});
export type FlowEnvelope = z.infer<typeof flowEnvelopeSchema>;

export const audienceEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("everyone_enrolled") }),
    z.object({
      kind: z.literal("subset"),
      userIds: z.array(userIdField).max(MAX_AUDIENCE_USER_IDS),
    }),
  ]),
});
export type AudienceEnvelope = z.infer<typeof audienceEnvelopeSchema>;

/**
 * Window timestamps are unix epoch ms — bare numbers, not Zod `Date` —
 * because `windowJson` is JSON at rest and JSON has no Date type. The
 * SPA converts to/from `Date` at the form boundary; the API does the
 * same at request decode. Independent nullability covers the "open from
 * this point, no deadline, no close" case versus "no window at all"
 * (the row-level `windowJson IS NULL`).
 */
export const windowEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.object({
    opensAt: z.number().int().nullable(),
    dueAt: z.number().int().nullable(),
    closesAt: z.number().int().nullable(),
  }),
});
export type WindowEnvelope = z.infer<typeof windowEnvelopeSchema>;

export const postClosePolicyEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("hidden") }),
    z.object({ kind: z.literal("visible_locked") }),
    z.object({ kind: z.literal("visible_completable") }),
  ]),
});
export type PostClosePolicyEnvelope = z.infer<typeof postClosePolicyEnvelopeSchema>;

/**
 * v1 only ships `manual_mark` and `all_parts_complete`. Signal-driven
 * variants (`quiz_passed`, `session_attended`) join this discriminated
 * union additively when the deferred completion-rule work lands; old
 * data with the v1 kinds keeps deserializing because the discriminator
 * is preserved.
 */
export const completionRuleEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("manual_mark") }),
    z.object({ kind: z.literal("all_parts_complete") }),
  ]),
});
export type CompletionRuleEnvelope = z.infer<typeof completionRuleEnvelopeSchema>;
