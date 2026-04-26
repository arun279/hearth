import type { LearningTrack, StudyGroupId, TrackStatus, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type ListTracksInGroupInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly status?: TrackStatus;
};

export type ListTracksInGroupDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * List the Learning Tracks belonging to a group. Powers the group-home
 * tracks section and the Tracks picker on invite creation. Visibility is
 * gated at the group level — once you can view the group, you can list its
 * tracks. Per-track viewability is tighter (handled by `getTrack`).
 */
export async function listTracksInGroup(
  input: ListTracksInGroupInput,
  deps: ListTracksInGroupDeps,
): Promise<readonly LearningTrack[]> {
  await loadViewableGroup(input.actor, input.groupId, deps);
  return deps.tracks.byGroup(input.groupId, input.status ? { status: input.status } : undefined);
}
