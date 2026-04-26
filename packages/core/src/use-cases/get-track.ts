import type {
  ContributionPolicyEnvelope,
  GroupMembership,
  LearningTrack,
  LearningTrackId,
  StudyGroup,
  TrackEnrollment,
  TrackStructureEnvelope,
  UserId,
} from "@hearth/domain";
import { canArchiveTrack } from "@hearth/domain/policy/can-archive-track";
import { canEditContributionPolicy } from "@hearth/domain/policy/can-edit-contribution-policy";
import { canEditTrackMetadata } from "@hearth/domain/policy/can-edit-track-metadata";
import { canEditTrackStructure } from "@hearth/domain/policy/can-edit-track-structure";
import { canPauseTrack } from "@hearth/domain/policy/can-pause-track";
import { canResumeTrack } from "@hearth/domain/policy/can-resume-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type GetTrackInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type GetTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Server-rendered capability hints for the track home. The SPA gates UI
 * affordances on these — the server still re-checks every mutation, so a
 * desync produces a 403, never a security hole. Mirrors the `GroupCaps`
 * shape for review symmetry.
 */
export type TrackCaps = {
  readonly canEditMetadata: boolean;
  readonly canEditStructure: boolean;
  readonly canEditContributionPolicy: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canArchive: boolean;
};

export type GetTrackResult = {
  readonly track: LearningTrack;
  /**
   * Denormalized parent group surface so the SPA can render the breadcrumb
   * and group-archived banner without a second `/g/:groupId` round trip.
   * Only the fields the breadcrumb / banner need are projected.
   */
  readonly group: {
    readonly id: StudyGroup["id"];
    readonly name: string;
    readonly status: StudyGroup["status"];
  };
  readonly myGroupMembership: GroupMembership | null;
  readonly myEnrollment: TrackEnrollment | null;
  readonly structure: TrackStructureEnvelope;
  readonly contributionPolicy: ContributionPolicyEnvelope;
  readonly caps: TrackCaps;
};

/**
 * Track-home payload. One round trip from the SPA covers everything the
 * hero band needs (track + group + my membership/enrollment + caps).
 * Counts for the tab badges live in `getTrackSummary` so listing tabs is
 * cheap and the hero render path stays small.
 */
export async function getTrack(input: GetTrackInput, deps: GetTrackDeps): Promise<GetTrackResult> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const [structure, contributionPolicy] = await Promise.all([
    deps.tracks.loadStructure(input.trackId),
    deps.tracks.loadContributionPolicy(input.trackId),
  ]);

  const caps: TrackCaps = {
    canEditMetadata: canEditTrackMetadata(actor, group, track, groupMembership, trackEnrollment).ok,
    canEditStructure: canEditTrackStructure(actor, group, track, groupMembership, trackEnrollment)
      .ok,
    canEditContributionPolicy: canEditContributionPolicy(
      actor,
      group,
      track,
      groupMembership,
      trackEnrollment,
    ).ok,
    canPause: canPauseTrack(actor, group, track, groupMembership, trackEnrollment).ok,
    canResume: canResumeTrack(actor, group, track, groupMembership, trackEnrollment).ok,
    canArchive: canArchiveTrack(actor, group, track, groupMembership, trackEnrollment).ok,
  };

  if (!structure || !contributionPolicy) {
    // The adapter returns null only when the row exists but the JSON
    // column is unparseable — schema-shim drift the operator must fix.
    // We surface as INVARIANT_VIOLATION rather than NOT_FOUND so a routine
    // reader of this code can find the broken envelope on a search.
    throw new Error("Track row found but JSON envelopes failed to parse — schema-shim drift?");
  }

  return {
    track,
    group: { id: group.id, name: group.name, status: group.status },
    myGroupMembership: groupMembership,
    myEnrollment: trackEnrollment,
    structure,
    contributionPolicy,
    caps,
  };
}
