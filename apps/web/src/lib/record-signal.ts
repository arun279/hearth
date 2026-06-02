/**
 * Evidence-Signal collection hook. v1 currently dispatches to a no-op:
 * the SPA emits signal events as Activity Parts mount, advance, and
 * unmount, but no flush mechanism is wired yet. When the hourly poller
 * + ingest endpoint land, this seam will start buffering events in
 * memory + flushing on `visibilitychange` / interval / Part completion,
 * coalescing per `(activityId, partId, signalType)` so the per-user
 * D1 write budget stays bounded.
 *
 * The shape is locked in now so Part renderers don't have to change
 * when the real implementation arrives. The signal types match the
 * canonical strings each Part kind emits per Activity-Part-catalog
 * documentation; new kinds extend this union when their Player
 * surfaces ship.
 */

type SignalType =
  | "scroll_position"
  | "last_viewed_at"
  | "playback_position"
  | "last_played_at"
  | "viewed_at";

type RecordSignalInput = {
  readonly activityId: string;
  readonly partId: string;
  readonly signalType: SignalType;
  /**
   * Loose typed for now — when the ingest endpoint lands the boundary
   * will validate via Zod per `signalType`. Most signals are numeric
   * (page, second) or boolean / null; the wire envelope wraps them.
   */
  readonly value: number | string | boolean | null;
};

/**
 * Emit one Evidence Signal. Currently a no-op stub; future
 * implementation will buffer in memory keyed by (activityId, partId,
 * signalType), flush on Part advance / visibility change / completion,
 * and respect the per-user daily D1 write budget.
 *
 * Returning `void` (not a Promise) is deliberate — callers must not
 * await this. Player Part components fire signals in `useEffect`
 * cleanups + DOM event handlers where awaiting would hold focus and
 * block the next Part from mounting.
 */
export function recordSignal(_input: RecordSignalInput): void {
  // Intentionally empty until the ingest endpoint ships. Keeping the
  // call sites in place now means the Part renderers never need to be
  // re-touched when the real implementation lands; only this function
  // body changes.
}
