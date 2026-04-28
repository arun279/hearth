import {
  DomainError,
  type LearningTrackId,
  type TrackEnrollment,
  type UserId,
} from "@hearth/domain";
import { canLeaveTrack } from "@hearth/domain/policy/can-leave-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type LeaveTrackInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type LeaveTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Self-leave wrapper around the `unenroll` adapter call. Functionally
 * `unenrollFromTrack(actor, actor)`, but kept as a distinct use case so
 * the SPA's leave flow has a dedicated route + telemetry and the deny
 * mapping (`would_orphan_facilitator → CONFLICT`) reads cleanly.
 *
 * Prior `ActivityRecord` rows for this enrollee are not cascaded — the
 * track keeps the historical attribution intact, so re-enrolling later
 * picks up where the prior session left off.
 */
export async function leaveTrack(
  input: LeaveTrackInput,
  deps: LeaveTrackDeps,
): Promise<TrackEnrollment> {
  const { group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const facilitatorCount = await deps.tracks.countFacilitators(input.trackId);
  const verdict = canLeaveTrack(group, track, groupMembership, trackEnrollment, facilitatorCount);
  if (!verdict.ok) {
    const code = verdict.reason.code === "would_orphan_facilitator" ? "CONFLICT" : "FORBIDDEN";
    throw new DomainError(code, verdict.reason.message, verdict.reason.code);
  }

  return deps.tracks.unenroll({
    trackId: input.trackId,
    userId: input.actor,
    by: input.actor,
  });
}
