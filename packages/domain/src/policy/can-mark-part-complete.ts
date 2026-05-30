import type { ActivityAccessState } from "../activity/types.ts";
import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { ActivityRecord } from "../record/types.ts";
import type { User } from "../user.ts";

/**
 * Mark one Part complete on the honor system. Three gates:
 *   1. the actor owns the record (a participant marks their own work),
 *   2. the activity is open (not pre-open, post-close-locked, or hidden),
 *   3. the Part's hard prerequisites are met — `prerequisitesMet` is
 *      computed by the use case from the Activity Flow's hard edges and
 *      the participant's current Part Progress.
 *
 * `minWords` and other soft nudges never gate here — they are advisory.
 * Completion is an invitation to participate, not a checkpoint.
 */
export function canMarkPartComplete(
  actor: User,
  record: ActivityRecord,
  accessState: ActivityAccessState,
  prerequisitesMet: boolean,
): PolicyResult {
  if (actor.id !== record.participantId) {
    return policyDeny("not_record_owner", "Only the participant may mark their own work complete.");
  }
  if (accessState !== "open") {
    return policyDeny(
      "activity_window_closed",
      "This activity is not open for completion right now.",
    );
  }
  if (!prerequisitesMet) {
    return policyDeny("prereq_not_met", "An earlier required Part must be completed first.");
  }
  return policyAllow();
}
