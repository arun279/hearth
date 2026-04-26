import type { LearningTrackId, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  LearningTrackSummaryCounts,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type GetTrackSummaryInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type GetTrackSummaryDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Composite count payload powering the track-home tab badges. In M4 every
 * count except `facilitatorCount` and `enrollmentCount` is 0 — the
 * activities, sessions, library, and pending aggregates land in M8 / M13 /
 * M6 / M15 respectively. Each count is intended to hit an indexed column
 * so this remains a small, bounded set of `count(*)` reads.
 */
export async function getTrackSummary(
  input: GetTrackSummaryInput,
  deps: GetTrackSummaryDeps,
): Promise<LearningTrackSummaryCounts> {
  // loadViewableTrack does the visibility check; if denied, the route maps
  // NOT_FOUND → 404 (no leak via 403/404 split).
  await loadViewableTrack(input.actor, input.trackId, deps);

  const [facilitatorCount, enrollmentCount] = await Promise.all([
    deps.tracks.countFacilitators(input.trackId),
    deps.tracks.countEnrollments(input.trackId),
  ]);

  return {
    activityCount: 0,
    sessionCount: 0,
    libraryItemCount: 0,
    pendingContributionCount: 0,
    facilitatorCount,
    enrollmentCount,
  };
}
