import type { TrackStatus } from "./track.ts";

/**
 * Legal status transitions for a Learning Track.
 *
 *   active   → paused, archived
 *   paused   → active, archived
 *   archived → (terminal — no escape)
 *
 * Shared by the use cases (server-side guard) and the SPA's track-settings
 * dialog (so disabled radio options match what the server will accept). Pure
 * — no async, no clock — so it stays SPA-importable per CI rule 9.
 */
const TRANSITIONS: Readonly<Record<TrackStatus, readonly TrackStatus[]>> = {
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

/** True iff the status flip is one of the legal track transitions above. */
export function canTransitionTrackTo(from: TrackStatus, to: TrackStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/**
 * Enumerate the transitions reachable from `from` (excluding the no-op
 * `from === to` case). The dialog uses this to disable radio options the
 * server would reject anyway.
 */
export function legalTrackTransitionsFrom(from: TrackStatus): readonly TrackStatus[] {
  return TRANSITIONS[from];
}
