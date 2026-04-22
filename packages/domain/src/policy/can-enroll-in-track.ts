import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership } from "../group.ts";
import type { LearningTrack } from "../track.ts";
import type { User } from "../user.ts";

export function canEnrollInTrack(
  actor: User,
  track: LearningTrack,
  membership: GroupMembership | null,
): PolicyResult {
  if (track.status === "archived") {
    return policyDeny("track_archived", "Archived tracks are read-only.");
  }
  if (!membership || membership.removedAt !== null) {
    return policyDeny(
      "not_a_member",
      "Actor must have Group Membership before enrolling in a Learning Track.",
    );
  }
  void actor;
  return policyAllow();
}
