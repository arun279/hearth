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
  /**
   * Best-available label for the member, computed server-side so the SPA
   * never has to render a placeholder. Resolution order:
   *   1. per-group nickname (`profile.nickname`)
   *   2. account display name (`user.name`)
   *   3. account email
   *   4. `displayNameSnapshot` (only set when a member has been removed —
   *      keeps history pages consistent post-leave)
   *   5. literal `"Member"` as a last-resort fallback (should never be
   *      reached for an active membership, but render-safe).
   */
  readonly displayName: string;
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

  // Resolve every membership's owner in parallel so the People page can
  // render a real name without a per-row round-trip from the SPA. Costs
  // O(members) point reads on the indexed `users.id` PK; for a v1 group
  // with ≤20 members the latency is dominated by the underlying batch.
  const users = await Promise.all(entries.map((m) => deps.users.byId(m.userId)));

  const rows: GroupMemberRow[] = entries.map((target, idx) => {
    const u = users[idx] ?? null;
    const displayName =
      target.profile.nickname ?? u?.name ?? u?.email ?? target.displayNameSnapshot ?? "Member";
    return {
      membership: target,
      displayName,
      capabilities: {
        canRemove: canRemoveGroupMember(actor, group, membership, target, adminCount, operator).ok,
        canPromote:
          target.role === "participant"
            ? canAssignGroupAdmin(actor, group, membership, target, "admin", adminCount, operator)
                .ok
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
    };
  });

  return { group, entries: rows, adminCount };
}
