import type { ActivityAccessState, ActivityWindow, PostClosePolicy } from "./types.ts";

/**
 * Resolve an Activity's `ActivityAccessState` from its window + post-close
 * policy at a moment in time. Pure, synchronous, SPA-importable per CI
 * rule 9 — `now` is injected (Clock port at the server, render time at
 * the client) so no `Date.now()` reads slip in.
 *
 * Boundary semantics:
 *   - `opensAt`: inclusive (now === opensAt → open). The window opens at
 *     that instant, not the instant after.
 *   - `closesAt`: inclusive (now === closesAt → still open). The close
 *     instant has not yet passed.
 *
 * Pre-open takes precedence over post-close: a window with both
 * `opensAt` and `closesAt` set is `pre_open` until `now >= opensAt`,
 * regardless of `closesAt`. (Pathologically, an activity whose author
 * misconfigured `closesAt < opensAt` would never become accessible — the
 * compose-time `assertWindowConsistent` invariant rejects that ordering.)
 *
 * `hidden` is reserved for the `hidden` post-close policy alone. The
 * route layer converts `hidden` into 404 so a viewer who once had access
 * stops being able to enumerate the activity by id after close.
 */
export function computeActivityAccessState(
  window: ActivityWindow | null,
  postClosePolicy: PostClosePolicy | null,
  now: Date,
): ActivityAccessState {
  if (window === null) return "open";
  const nowMs = now.getTime();

  if (window.opensAt !== null && nowMs < window.opensAt) {
    return "pre_open";
  }

  if (window.closesAt !== null && nowMs > window.closesAt) {
    if (postClosePolicy === null) return "open";
    if (postClosePolicy.kind === "hidden") return "hidden";
    if (postClosePolicy.kind === "visible_locked") return "locked";
  }

  return "open";
}
