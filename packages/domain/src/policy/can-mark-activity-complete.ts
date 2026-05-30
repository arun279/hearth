import type { ActivityAccessState, CompletionRule } from "../activity/types.ts";
import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { ActivityRecord } from "../record/types.ts";
import type { User } from "../user.ts";

/**
 * Mark the whole Activity Record complete. The participant owns the record
 * and the activity must be open. Under the `all_parts_complete` rule the
 * record can only be completed once every Part is done (`allPartsComplete`,
 * computed by the use case); under `manual_mark` the participant may
 * complete it directly on the honor system.
 */
export function canMarkActivityComplete(
  actor: User,
  record: ActivityRecord,
  completionRule: CompletionRule,
  accessState: ActivityAccessState,
  allPartsComplete: boolean,
): PolicyResult {
  if (actor.id !== record.participantId) {
    return policyDeny("not_record_owner", "Only the participant may complete their own record.");
  }
  if (accessState !== "open") {
    return policyDeny(
      "activity_window_closed",
      "This activity is not open for completion right now.",
    );
  }
  if (completionRule.kind === "all_parts_complete" && !allPartsComplete) {
    return policyDeny(
      "parts_incomplete",
      "Every Part must be complete before the activity can be marked done.",
    );
  }
  return policyAllow();
}
