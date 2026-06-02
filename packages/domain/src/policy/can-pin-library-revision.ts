import type { PolicyResult } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { evaluateActivityScopeAuthority } from "./_activity-scope-gate.ts";

/**
 * Pin (or unpin) a specific Library Revision on an Activity's library
 * ref. Pinning shields a published activity from a Library Item update
 * mid-flight — the bound revision continues to render until a
 * facilitator explicitly re-pins or unpins to follow the latest
 * revision. The pinned-revision-must-belong-to-the-same-item invariant
 * lives in the use case (`pinned_revision_not_in_item`) and the adapter
 * (FK).
 */
export function canPinLibraryRevision(
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
    actionLabel: "pin a Library Revision",
  });
}
