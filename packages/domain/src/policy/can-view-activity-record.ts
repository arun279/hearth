import type { PolicyDenialReason } from "../errors.ts";
import type { GroupMembership } from "../group.ts";
import type { InstanceOperator } from "../instance.ts";
import type { ActivityRecord } from "../record/types.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isActiveOperator } from "./helpers.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * The detail level at which an Activity Record may be shown to a viewer.
 * `full` exposes Part Progress and authored content; `summary` exposes only
 * completion state; `hidden` means the viewer must not learn the record
 * exists (the route returns 404).
 */
export type ActivityRecordScope = "full" | "summary" | "hidden";

export type ViewActivityRecordResult =
  | { readonly ok: true; readonly scope: ActivityRecordScope }
  | { readonly ok: false; readonly reason: PolicyDenialReason };

/**
 * Decide whether a viewer may read an Activity Record, and at what detail.
 * The participant sees their own work in full; an Instance Operator and any
 * Track authority (Group Admin or Track Facilitator) also see full detail —
 * facilitators carry curation responsibility for the track's work.
 *
 * The detail level for OTHER group members (a `summary` at the group level,
 * narrowed or widened by the participant's Visibility Preference) is the
 * read-time projection that lands in a later milestone; until then a
 * non-authority viewer is denied and the route returns 404, leaking
 * nothing. The `scope` return shape is in place now so that projection can
 * fill the denied branch without changing this signature's callers.
 */
export function canViewActivityRecord(
  actor: User,
  record: ActivityRecord,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
  operator: InstanceOperator | null,
): ViewActivityRecordResult {
  if (actor.id === record.participantId) return { ok: true, scope: "full" };
  if (isActiveOperator(actor, operator)) return { ok: true, scope: "full" };
  if (isAuthorityOverTrack(track, groupMembership, trackEnrollment)) {
    return { ok: true, scope: "full" };
  }
  return {
    ok: false,
    reason: { code: "not_record_owner", message: "This record is not visible to you." },
  };
}
