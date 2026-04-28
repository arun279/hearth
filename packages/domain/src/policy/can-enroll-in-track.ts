import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupMembership, StudyGroup } from "../group.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import { isCurrentMember } from "./helpers.ts";
import { isAuthorityOverTrack } from "./is-authority-over-track.ts";

/**
 * The actor enrolls themselves in a track. Active group membership is
 * required: track enrollment is a strictly-stronger predicate than group
 * membership — you cannot be enrolled in a track without being a current
 * member of its group. Paused tracks accept new enrollments — the
 * carve-out is intentional so a returning member can re-engage without
 * first unpausing the track. Archived tracks are read-only end-to-end.
 */
export function canEnrollSelfInTrack(
  actor: User,
  track: LearningTrack,
  group: StudyGroup,
  membership: GroupMembership | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny(
      "group_archived",
      "Tracks inside an archived group cannot be modified independently.",
    );
  }
  if (track.status === "archived") {
    return policyDeny("track_archived", "Archived tracks do not allow new enrollments.");
  }
  if (!isCurrentMember(membership, group.id)) {
    return policyDeny(
      "not_a_member",
      "Group Membership is required before enrolling in a Learning Track.",
    );
  }
  void actor;
  return policyAllow();
}

/**
 * A track authority enrolls another current group member. Mirrors
 * `canEnrollSelfInTrack` but the membership being checked is the *target's*,
 * not the actor's. The actor's authority comes from group-admin status or
 * an active facilitator enrollment on the same track.
 */
export function canEnrollUserInTrack(
  actor: User,
  track: LearningTrack,
  group: StudyGroup,
  actorMembership: GroupMembership | null,
  actorEnrollment: TrackEnrollment | null,
  targetMembership: GroupMembership | null,
): PolicyResult {
  if (group.status === "archived") {
    return policyDeny(
      "group_archived",
      "Tracks inside an archived group cannot be modified independently.",
    );
  }
  if (track.status === "archived") {
    return policyDeny("track_archived", "Archived tracks do not allow new enrollments.");
  }
  if (!isAuthorityOverTrack(track, actorMembership, actorEnrollment)) {
    return policyDeny(
      "not_track_authority",
      "Only a Group Admin or Track Facilitator may enroll another member.",
    );
  }
  if (!isCurrentMember(targetMembership, group.id)) {
    return policyDeny(
      "enrollment_requires_membership",
      "The target must already be a current member of the group.",
    );
  }
  void actor;
  return policyAllow();
}
