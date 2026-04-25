import type { GroupMembership, StudyGroup, StudyGroupId, UserId } from "@hearth/domain";
import { canArchiveGroup } from "@hearth/domain/policy/can-archive-group";
import { canUnarchiveGroup } from "@hearth/domain/policy/can-unarchive-group";
import { canUpdateGroupMetadata } from "@hearth/domain/policy/can-update-group-metadata";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupCounts,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type GetGroupInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
};

export type GetGroupDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Server-rendered capability hints for the group home. The SPA gates UI
 * affordances on these — the server still re-checks every mutation, so a
 * desync produces a 403 rather than a security hole.
 */
export type GroupCaps = {
  readonly canArchive: boolean;
  readonly canUnarchive: boolean;
  readonly canUpdateMetadata: boolean;
};

export type GetGroupResult = {
  readonly group: StudyGroup;
  readonly myMembership: GroupMembership | null;
  readonly counts: StudyGroupCounts;
  readonly caps: GroupCaps;
};

export async function getGroup(input: GetGroupInput, deps: GetGroupDeps): Promise<GetGroupResult> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const counts = await deps.groups.counts(input.groupId);
  const caps: GroupCaps = {
    canArchive: canArchiveGroup(actor, group, membership).ok,
    canUnarchive: canUnarchiveGroup(actor, group, membership).ok,
    canUpdateMetadata: canUpdateGroupMetadata(actor, group, membership).ok,
  };

  return { group, myMembership: membership, counts, caps };
}
