import type { LearningTrack } from "./track.ts";

/**
 * Pure invariant helpers over the LearningTrack aggregate.
 *
 * `isWritableTrack` is the read-side mirror of the adapter's
 * `assertWritable(env)` — true iff the track currently allows mutation.
 * Archived tracks are frozen entirely; paused tracks still permit the
 * carve-outs (metadata, structure, contribution policy edits, status flip
 * to active or archived) — those callers gate on `isPausedEditable` plus
 * the policy.
 *
 * Kept SPA-importable per CI rule 9 — no async, no clock, no Node globals.
 */
export function isWritableTrack(track: LearningTrack): boolean {
  return track.status !== "archived";
}

/**
 * `paused` tracks are still mutable for the metadata / structure / policy
 * carve-outs (a facilitator can fix a typo or tighten review while paused).
 * Use this in capability projections so the SPA's settings affordances stay
 * available when the track is paused but not when it's archived.
 */
export function isTrackEditable(track: LearningTrack): boolean {
  return track.status !== "archived";
}
