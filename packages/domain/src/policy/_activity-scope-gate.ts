import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * Shared authority gate for the seven Activity-scope policies
 * (`canEditLearningActivity`, `canDeleteLearningActivity`,
 * `canPinLibraryRevision`, `canSetPrerequisites`,
 * `canSetSuggestedSequences`, `canNarrowAudience`, plus
 * `canCreateLearningActivity` which adds its own paused-track refusal).
 *
 * Each public policy calls this helper and supplies its own
 * action-specific copy via the `actionLabel` parameter — the gate logic
 * is identical (track-authority + non-archived parent group +
 * non-archived track), so factoring it into one place keeps the seven
 * predicates in lockstep when the gate evolves.
 *
 * Paused tracks remain editable for in-flight activity edits — pause
 * stops *new* activities. `canCreateLearningActivity` re-asserts the
 * paused-track refusal directly.
 */
export function evaluateActivityScopeAuthority(args: {
  readonly group: StudyGroup;
  readonly track: LearningTrack;
  readonly groupMembership: GroupMembership | null;
  readonly trackEnrollment: TrackEnrollment | null;
  readonly actionLabel: string;
}): PolicyResult {
  if (args.group.status === "archived") {
    return policyDeny("group_archived", `Archived groups do not allow ${args.actionLabel}.`);
  }
  if (args.track.status === "archived") {
    return policyDeny("track_archived", `Archived tracks do not allow ${args.actionLabel}.`);
  }
  if (!isAuthorityOverTrack(args.track, args.groupMembership, args.trackEnrollment)) {
    return policyDeny(
      "not_track_authority",
      `Only a Group Admin or Track Facilitator may ${args.actionLabel}.`,
    );
  }
  return policyAllow();
}
