import {
  canTransitionTrackTo,
  DomainError,
  type LearningTrack,
  type LearningTrackId,
  type UserId,
} from "@hearth/domain";
import { canArchiveTrack } from "@hearth/domain/policy/can-archive-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type ArchiveTrackInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type ArchiveTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Archive a Learning Track (terminal — no escape). Idempotent: a retry
 * against an already-archived track resolves as a no-op success.
 */
export async function archiveTrack(
  input: ArchiveTrackInput,
  deps: ArchiveTrackDeps,
): Promise<LearningTrack> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const verdict = canArchiveTrack(actor, group, track, groupMembership, trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (track.status === "archived") return track;
  if (!canTransitionTrackTo(track.status, "archived")) {
    throw new DomainError(
      "CONFLICT",
      `Cannot archive a ${track.status} track.`,
      "track_status_transition_invalid",
    );
  }

  return deps.tracks.updateStatus({
    id: input.trackId,
    to: "archived",
    expectedFromStatus: track.status,
    by: input.actor,
  });
}
