import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { ActivityRecord } from "../record/types.ts";
import type { User } from "../user.ts";

/**
 * Only the participant may set the per-record Visibility override on their
 * own Activity Record. Facilitators and admins never adjust another
 * person's audience preference — they only ever read (always at full
 * detail, per the visibility model).
 */
export function canOverrideActivityRecordVisibility(
  actor: User,
  record: ActivityRecord,
): PolicyResult {
  if (actor.id !== record.participantId) {
    return policyDeny(
      "not_record_owner",
      "Only the participant may change their record's visibility.",
    );
  }
  return policyAllow();
}
