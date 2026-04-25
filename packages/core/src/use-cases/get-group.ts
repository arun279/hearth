import {
  DomainError,
  type GroupMembership,
  type StudyGroup,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { canArchiveGroup } from "@hearth/domain/policy/can-archive-group";
import { canUnarchiveGroup } from "@hearth/domain/policy/can-unarchive-group";
import { canUpdateGroupMetadata } from "@hearth/domain/policy/can-update-group-metadata";
import { canViewGroup } from "@hearth/domain/policy/can-view-group";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupCounts,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

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
  const [actor, group, membership, operator] = await Promise.all([
    deps.users.byId(input.actor),
    deps.groups.byId(input.groupId),
    deps.groups.membership(input.groupId, input.actor),
    deps.policy.getOperator(input.actor),
  ]);

  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found.");
  if (!group) throw new DomainError("NOT_FOUND", "Group not found.", "not_found");

  // Non-member non-operator probing by id must not distinguish "doesn't
  // exist" from "exists but I'm not in it". Both paths above and the
  // verdict below throw `DomainError("NOT_FOUND", …)`; the API layer's
  // `mapUnknown` → `problemFromDomainError` then maps NOT_FOUND → 404.
  const verdict = canViewGroup(actor, group, membership, operator);
  if (!verdict.ok) {
    throw new DomainError("NOT_FOUND", verdict.reason.message, verdict.reason.code);
  }

  const counts = await deps.groups.counts(input.groupId);
  const caps: GroupCaps = {
    canArchive: canArchiveGroup(actor, group, membership).ok,
    canUnarchive: canUnarchiveGroup(actor, group, membership).ok,
    canUpdateMetadata: canUpdateGroupMetadata(actor, group, membership).ok,
  };

  return { group, myMembership: membership, counts, caps };
}
