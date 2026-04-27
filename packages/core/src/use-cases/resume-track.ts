import {
  canTransitionTrackTo,
  DomainError,
  type LearningTrack,
  type LearningTrackId,
  type UserId,
} from "@hearth/domain";
import { canResumeTrack } from "@hearth/domain/policy/can-resume-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type ResumeTrackInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type ResumeTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Resume a paused Learning Track. Idempotent: a retry against an
 * already-active track resolves as a no-op success. Mirror of
 * `pauseTrack`.
 */
export async function resumeTrack(
  input: ResumeTrackInput,
  deps: ResumeTrackDeps,
): Promise<LearningTrack> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const verdict = canResumeTrack(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (track.status === "active") return track;
  if (!canTransitionTrackTo(track.status, "active")) {
    throw new DomainError(
      "CONFLICT",
      `Cannot resume a ${track.status} track.`,
      "track_status_transition_invalid",
    );
  }

  return deps.tracks.updateStatus({
    id: input.trackId,
    to: "active",
    expectedFromStatus: track.status,
    by: input.actor,
  });
}
