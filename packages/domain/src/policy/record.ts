import type { ActivityAccessState } from "../activity/types.ts";
import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { ActivityRecord } from "../record/types.ts";
import type { User } from "../user.ts";
import { isCurrentMember } from "./helpers.ts";

/**
 * A window-driven access state that forbids authoring new completion: the
 * activity has closed under a `visible_locked` (`locked`) or `hidden`
 * post-close policy. `open` and `pre_open` both leave the door open for a
 * participant to mark progress (`pre_open` is handled at the route layer,
 * which 404s a not-yet-open activity before policy runs).
 */
function isClosedToCompletion(accessState: ActivityAccessState): boolean {
  return accessState === "locked" || accessState === "hidden";
}

/**
 * May the actor mark one Part of their own record complete? Honor-system —
 * the only gates are ownership, an unmet hard-prerequisite, and a closed
 * window. `prereqsMet` is computed by the caller from the activity Flow's
 * `hard` edges against the participant's current progress.
 */
export function canMarkPartComplete(
  actor: User,
  record: ActivityRecord,
  prereqsMet: boolean,
  accessState: ActivityAccessState,
): PolicyResult {
  if (record.participantId !== actor.id) {
    return policyDeny("not_record_owner", "Actor does not own this Activity Record.");
  }
  if (isClosedToCompletion(accessState)) {
    return policyDeny("activity_window_closed", "This activity's window has closed.");
  }
  if (!prereqsMet) {
    return policyDeny("prereq_not_met", "A required prerequisite Part is not yet complete.");
  }
  return policyAllow();
}

/**
 * May the actor mark their own activity record complete? Under the
 * `all_parts_complete` Completion Rule every Part must already be marked
 * complete (`allPartsComplete`); under `manual_mark` the participant may
 * complete at will, so the caller passes `allPartsComplete = true`.
 */
export function canMarkActivityComplete(
  actor: User,
  record: ActivityRecord,
  allPartsComplete: boolean,
  accessState: ActivityAccessState,
): PolicyResult {
  if (record.participantId !== actor.id) {
    return policyDeny("not_record_owner", "Actor does not own this Activity Record.");
  }
  if (isClosedToCompletion(accessState)) {
    return policyDeny("activity_window_closed", "This activity's window has closed.");
  }
  if (!allPartsComplete) {
    return policyDeny("parts_incomplete", "Not every Part is complete yet.");
  }
  return policyAllow();
}

/**
 * May the actor reset a participant's progress on this activity? Track
 * Facilitator (or Group Admin) only — `isAuthorityOverTrack` is resolved
 * by the caller from the actor's group membership + track enrollment.
 */
export function canResetParticipantProgress(isAuthorityOverTrack: boolean): PolicyResult {
  if (!isAuthorityOverTrack) {
    return policyDeny(
      "not_track_authority",
      "Only a Track Facilitator may reset a participant's progress.",
    );
  }
  return policyAllow();
}

/**
 * May the actor change the visibility override on their own record? The
 * participant alone owns this choice.
 */
export function canOverrideActivityRecordVisibility(
  actor: User,
  record: ActivityRecord,
): PolicyResult {
  if (record.participantId !== actor.id) {
    return policyDeny("not_record_owner", "Actor does not own this Activity Record.");
  }
  return policyAllow();
}

/**
 * May the actor view this participant's Activity Record at all? The access
 * gate only: the participant themselves, or a current member of the
 * record's group. The *detail* a viewer resolves (`full` / `summary` /
 * `hidden`) is the visibility resolver's separate concern, layered after
 * this gate by the use case — a denial here and a `hidden` resolution there
 * both funnel to a byte-identical 404.
 *
 * The route surfaces a denial as 404 (viewability-before-authorization) so a
 * non-member probing a record id cannot distinguish "exists but forbidden"
 * from "does not exist". `groupId` is the record's group and
 * `viewerMembership` is the actor's membership in it (the caller loads
 * `groups.membership(groupId, actor)`); `isCurrentMember` re-matches the
 * group id defensively so a wrong-group row can never grant access.
 */
export function canViewActivityRecord(
  actor: User,
  record: ActivityRecord,
  viewerMembership: GroupMembership | null,
  groupId: StudyGroup["id"],
): PolicyResult {
  if (record.participantId === actor.id) return policyAllow();
  if (isCurrentMember(viewerMembership, groupId)) return policyAllow();
  return policyDeny("not_record_owner", "Actor cannot view this Activity Record.");
}
