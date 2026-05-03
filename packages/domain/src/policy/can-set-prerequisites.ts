import type { PolicyResult } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { evaluateActivityScopeAuthority } from "./_activity-scope-gate.ts";

/**
 * Set the activity's hard cross-activity prerequisite edges. Same-track
 * + acyclic-DAG invariants live in the use case + adapter; this
 * predicate covers only the authority gate.
 */
export function canSetPrerequisites(
  actor: User,
  group: StudyGroup,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
): PolicyResult {
  void actor;
  return evaluateActivityScopeAuthority({
    group,
    track,
    groupMembership,
    trackEnrollment,
    actionLabel: "set Prerequisites",
  });
}
