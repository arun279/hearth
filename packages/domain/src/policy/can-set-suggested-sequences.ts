import type { PolicyResult } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { evaluateActivityScopeAuthority } from "./_activity-scope-gate.ts";

/**
 * Set the activity's soft suggested-next edges. No cycle check — these
 * are presentation-only "after this, often that" hints. Same-track
 * invariant lives in the use case.
 */
export function canSetSuggestedSequences(
  _actor: User,
  group: StudyGroup,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
): PolicyResult {
  return evaluateActivityScopeAuthority({
    group,
    track,
    groupMembership,
    trackEnrollment,
    actionLabel: "set Suggested Sequences",
  });
}
