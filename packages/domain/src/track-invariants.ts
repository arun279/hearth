import type { LearningTrack, TrackEnrollment } from "./track.ts";

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

/**
 * True iff removing OR demoting the target enrollment would leave the
 * track with zero active facilitators. The caller passes the cheap indexed
 * `currentFacilitatorCount` so the predicate stays sync + pure.
 *
 * The transition is "would orphan" when:
 *  - the target is a current (un-left) facilitator of this track, AND
 *  - the active facilitator count is 1 (only this facilitator left), AND
 *  - the track is still active (paused / archived tracks intentionally
 *    allow the facilitator count to fall to zero — frozen tracks have no
 *    live invariant to guard).
 *
 * Mirrors `wouldOrphanAdmin` for the StudyGroup aggregate.
 */
export function wouldOrphanFacilitator(
  track: LearningTrack,
  target: TrackEnrollment,
  currentFacilitatorCount: number,
): boolean {
  if (track.status !== "active") return false;
  if (target.leftAt !== null) return false;
  if (target.role !== "facilitator") return false;
  if (target.trackId !== track.id) return false;
  return currentFacilitatorCount <= 1;
}
