import {
  canTransitionTrackTo,
  DomainError,
  type LearningTrack,
  type LearningTrackId,
  type UserId,
} from "@hearth/domain";
import { canPauseTrack } from "@hearth/domain/policy/can-pause-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type PauseTrackInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type PauseTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Pause an active Learning Track. Idempotent: a retry against an
 * already-paused track resolves as a no-op success rather than 4xx. The
 * `archived → paused` transition is illegal and surfaces as CONFLICT
 * `track_status_transition_invalid`.
 */
export async function pauseTrack(
  input: PauseTrackInput,
  deps: PauseTrackDeps,
): Promise<LearningTrack> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const verdict = canPauseTrack(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (track.status === "paused") return track;
  if (!canTransitionTrackTo(track.status, "paused")) {
    throw new DomainError(
      "CONFLICT",
      `Cannot pause a ${track.status} track.`,
      "track_status_transition_invalid",
    );
  }

  return deps.tracks.updateStatus({
    id: input.trackId,
    to: "paused",
    expectedFromStatus: track.status,
    by: input.actor,
  });
}
