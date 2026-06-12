import { computeActivityAccessState, DomainError, type LearningActivity } from "@hearth/domain";

/**
 * Gate a participant *write* on the activity's window state. Reads stay open
 * across these states (the player still renders the chrome); only writes are
 * blocked. `hidden` collapses to 404 so a post-close-hidden activity stops
 * being enumerable by id; `pre_open` / `locked` are 409 conflicts that name
 * why the write can't land. Visibility-override writes deliberately skip this
 * — privacy stays adjustable after close.
 */
export function assertActivityWritable(activity: LearningActivity, now: Date): void {
  const state = computeActivityAccessState(activity.window, activity.postClosePolicy, now);
  if (state === "hidden") {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }
  if (state === "pre_open") {
    throw new DomainError("CONFLICT", "This activity isn't open yet.", "activity_not_open");
  }
  if (state === "locked") {
    throw new DomainError("CONFLICT", "This activity is closed.", "activity_closed");
  }
}
