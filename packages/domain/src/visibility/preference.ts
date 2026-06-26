import { z } from "zod";

/**
 * A participant's chosen visibility for their work. It lives in two places:
 * the per-record override on `activity_records.visibility_override_json`
 * (NULL = fall back to the user's default) and the per-user default on
 * `users.visibility_preference_json` (NULL = the `default` preference). The
 * *resolution* of a preference into an observable scope (`full` / `summary`
 * / `hidden`) for a given viewer is a separate concern (see `resolve.ts`);
 * this module owns only the canonical stored values and their wire envelope.
 *
 * The wire strings are canonical and load-bearing — the SPA maps them to
 * friendlier labels at the display layer (see `visibility-labels.ts`), but
 * the stored/transported value is always one of these.
 */
export const VISIBILITY_PREFERENCES = ["default", "track_only", "private"] as const;

export type VisibilityPreference = (typeof VISIBILITY_PREFERENCES)[number];

/**
 * The observable scope a given viewer resolves to for an Activity Record:
 * the participant's full working state, a redacted summary, or nothing.
 * The *resolution* of a stored `VisibilityPreference` into one of these for
 * a specific viewer is M12's concern; M11 declares the union so the
 * `canViewActivityRecord` signature is M12-stable (M11 returns `"full"`
 * only, for the participant's own read).
 */
export type VisibilityScope = "full" | "summary" | "hidden";

export const visibilityPreferenceSchema = z.enum(VISIBILITY_PREFERENCES);

/**
 * Versioned envelope wrapping a stored {@link VisibilityPreference}. The same
 * `{ v, data }` convention as every other JSON column, so a future shape
 * change bumps `v` and adds a read-time shim. One schema backs both columns
 * that persist a preference — the per-record `activity_records.visibility_override_json`
 * and the per-user default `users.visibility_preference_json` — so a writer
 * and a reader on either column can never drift apart.
 */
export const visibilityPreferenceEnvelopeSchema = z.object({
  v: z.literal(1),
  data: z.object({ preference: visibilityPreferenceSchema }),
});

export type VisibilityPreferenceEnvelope = z.infer<typeof visibilityPreferenceEnvelopeSchema>;
