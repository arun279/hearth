import type { GroupMembership, StudyGroup, StudyGroupId, UserId } from "@hearth/domain";
import { canArchiveGroup } from "@hearth/domain/policy/can-archive-group";
import { canCreateGroupInvitation } from "@hearth/domain/policy/can-create-group-invitation";
import { canManageGroupMembership } from "@hearth/domain/policy/can-manage-group-membership";
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
 *
 * `canManageMembership` and `canCreateInvitation` are tracked separately
 * from `canUpdateMetadata` because the underlying policies have wider
 * authority — Instance Operators inherit them via the operator carve-out,
 * but they don't hold a Group Admin membership and so wouldn't satisfy
 * `canUpdateGroupMetadata`. Without these caps, an operator's recovery
 * path (the reason the policy was written this way) sees no admin
 * affordances on the People page even though every server-side mutation
 * would accept them.
 */
export type GroupCaps = {
  readonly canArchive: boolean;
  readonly canUnarchive: boolean;
  readonly canUpdateMetadata: boolean;
  readonly canManageMembership: boolean;
  readonly canCreateInvitation: boolean;
};

export type GetGroupResult = {
  readonly group: StudyGroup;
  readonly myMembership: GroupMembership | null;
  readonly counts: StudyGroupCounts;
  readonly caps: GroupCaps;
};

export async function getGroup(input: GetGroupInput, deps: GetGroupDeps): Promise<GetGroupResult> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const [counts, operator] = await Promise.all([
    deps.groups.counts(input.groupId),
    deps.policy.getOperator(input.actor),
  ]);
  const caps: GroupCaps = {
    canArchive: canArchiveGroup(actor, group, membership).ok,
    canUnarchive: canUnarchiveGroup(actor, group, membership).ok,
    canUpdateMetadata: canUpdateGroupMetadata(actor, group, membership).ok,
    canManageMembership: canManageGroupMembership(actor, group, membership, operator).ok,
    canCreateInvitation: canCreateGroupInvitation(actor, group, membership, operator).ok,
  };

  return { group, myMembership: membership, counts, caps };
}
