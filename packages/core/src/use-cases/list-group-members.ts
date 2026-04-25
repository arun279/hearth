import type { GroupMembership, StudyGroup, StudyGroupId, UserId } from "@hearth/domain";
import { canAssignGroupAdmin } from "@hearth/domain/policy/can-assign-group-admin";
import { canRemoveGroupMember } from "@hearth/domain/policy/can-remove-group-member";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type ListGroupMembersInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
};

export type ListGroupMembersDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Per-row capability bundle so the SPA can disable / hide management
 * affordances without per-row round-trips. The server re-checks each
 * mutation; these are gating hints, not authority.
 */
export type GroupMemberCapabilities = {
  readonly canRemove: boolean;
  readonly canPromote: boolean;
  readonly canDemote: boolean;
};

export type GroupMemberRow = {
  readonly membership: GroupMembership;
  readonly capabilities: GroupMemberCapabilities;
};

export type ListGroupMembersResult = {
  readonly group: StudyGroup;
  readonly entries: readonly GroupMemberRow[];
  readonly adminCount: number;
};

/**
 * List the active members of a group along with per-row capabilities the
 * actor holds over each. Computing capabilities here (instead of on the
 * SPA) keeps the orphan-admin guard server-authoritative; the SPA only
 * mirrors the predicates for instant UI gating.
 */
export async function listGroupMembers(
  input: ListGroupMembersInput,
  deps: ListGroupMembersDeps,
): Promise<ListGroupMembersResult> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const [entries, adminCount, operator] = await Promise.all([
    deps.groups.listMemberships(input.groupId),
    deps.groups.countAdmins(input.groupId),
    deps.policy.getOperator(input.actor),
  ]);

  const rows: GroupMemberRow[] = entries.map((target) => ({
    membership: target,
    capabilities: {
      canRemove: canRemoveGroupMember(actor, group, membership, target, adminCount, operator).ok,
      canPromote:
        target.role === "participant"
          ? canAssignGroupAdmin(actor, group, membership, target, "admin", adminCount, operator).ok
          : false,
      canDemote:
        target.role === "admin"
          ? canAssignGroupAdmin(
              actor,
              group,
              membership,
              target,
              "participant",
              adminCount,
              operator,
            ).ok
          : false,
    },
  }));

  return { group, entries: rows, adminCount };
}
