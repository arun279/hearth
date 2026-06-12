import type { ActivityAudience } from "../activity/types.ts";
import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isCurrentEnrollment } from "./helpers.ts";

/**
 * May the actor author/resume their OWN participant state — reflection
 * draft, quiz answers, visibility override — for this activity?
 *
 * Stricter than `canSeeActivity` on purpose. Seeing an activity is open to
 * Instance Operators, track authorities, and (for an `everyone_enrolled`
 * audience) any group member. But only a CURRENT track enrollee who is an
 * audience target actually *does* the activity and gets an ActivityRecord:
 * a facilitator QA-ing a subset activity they aren't part of can view it,
 * yet is not a participant here. The SPA reads this to decide whether the
 * interactive Parts render editable or read-only.
 */
export function canRecordOwnActivityProgress(
  actor: User,
  track: LearningTrack,
  audience: ActivityAudience,
  enrollment: TrackEnrollment | null,
): PolicyResult {
  if (!isCurrentEnrollment(enrollment, track.id)) {
    return policyDeny("not_track_enrollee", "Actor is not a current enrollee on this track.");
  }
  if (audience.kind === "subset" && !audience.userIds.some((id) => id === actor.id)) {
    return policyDeny("not_in_audience", "Actor is not in this Activity's audience.");
  }
  return policyAllow();
}
