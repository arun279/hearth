import { z } from "zod";

/**
 * A participant's Visibility Preference: the audience for their Activity
 * Records. `default` follows the context's natural audience; `track_only`
 * narrows group-level surfacing; `private` keeps detail to the participant
 * (facilitators always retain full view of their track's work).
 *
 * This is the stored override value on a single record AND the type of a
 * participant's account-level default. Resolving a preference into a
 * concrete `full | summary | hidden` scope is a separate read-time
 * projection (a later milestone) — this module owns only the wire value.
 */
export const VISIBILITY_PREFERENCES = ["default", "track_only", "private"] as const;

export type VisibilityPreference = (typeof VISIBILITY_PREFERENCES)[number];

export const visibilityPreferenceSchema = z.enum(VISIBILITY_PREFERENCES);

/**
 * Versioned envelope stored in `activity_records.visibilityOverrideJson`.
 * A `null` column means "no override — use the participant's default";
 * a present envelope pins the per-record exception. The `v` discriminator
 * lets the shape evolve via read-time shims without a backfill.
 */
export const visibilityOverrideEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.object({ preference: visibilityPreferenceSchema }),
});

export type VisibilityOverrideEnvelope = z.infer<typeof visibilityOverrideEnvelopeSchema>;
