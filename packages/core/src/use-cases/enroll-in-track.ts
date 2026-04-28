import {
  DomainError,
  type LearningTrackId,
  type TrackEnrollment,
  type UserId,
} from "@hearth/domain";
import {
  canEnrollSelfInTrack,
  canEnrollUserInTrack,
} from "@hearth/domain/policy/can-enroll-in-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type EnrollInTrackInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
  /**
   * When provided, the actor enrolls `targetUserId` (authority path).
   * When omitted, the actor enrolls themselves (self path). The two paths
   * exercise different policy predicates so deny copy stays specific.
   */
  readonly targetUserId?: UserId;
};

export type EnrollInTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Enroll a user in a Learning Track. Self-path: the actor enrolls
 * themselves. Authority-path: a Group Admin or active Track Facilitator
 * enrolls another current Group Member.
 *
 * The adapter is the authoritative gate — it re-checks membership inside
 * the same UPSERT to prevent a TOCTOU between the policy verdict and the
 * write. Re-enrollment after a soft leave revives the existing row
 * (UNIQUE forbids two rows on `(trackId, userId)`).
 */
export async function enrollInTrack(
  input: EnrollInTrackInput,
  deps: EnrollInTrackDeps,
): Promise<TrackEnrollment> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const targetId = input.targetUserId ?? input.actor;
  const isSelf = targetId === input.actor;

  if (isSelf) {
    const verdict = canEnrollSelfInTrack(actor, track, group, groupMembership);
    if (!verdict.ok) {
      const code = verdict.reason.code === "track_archived" ? "CONFLICT" : "FORBIDDEN";
      throw new DomainError(code, verdict.reason.message, verdict.reason.code);
    }
  } else {
    const targetMembership = await deps.groups.membership(group.id, targetId);
    const verdict = canEnrollUserInTrack(
      actor,
      track,
      group,
      groupMembership,
      trackEnrollment,
      targetMembership,
    );
    if (!verdict.ok) {
      const code = verdict.reason.code === "track_archived" ? "CONFLICT" : "FORBIDDEN";
      throw new DomainError(code, verdict.reason.message, verdict.reason.code);
    }
  }

  return deps.tracks.enroll({
    trackId: input.trackId,
    userId: targetId,
    by: input.actor,
  });
}
