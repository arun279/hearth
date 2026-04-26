import type { GroupInvitation, GroupInvitationStatus, StudyGroupId, UserId } from "@hearth/domain";
import { invitationStatus } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadInvitationAuthority } from "./_lib/load-invitation-authority.ts";

export type ListGroupInvitationsInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly now: Date;
};

export type ListGroupInvitationsDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

export type GroupInvitationView = {
  readonly invitation: GroupInvitation;
  readonly status: GroupInvitationStatus;
};

/**
 * The list is admin-only — invitee email addresses are PII and the SPA
 * surfaces the manage-invitations affordance only when the actor has
 * `canManageGroupMembership`. Reuse the create-invitation predicate to
 * gate access since the authority shape is identical.
 *
 * Each row carries its derived status enum so the SPA renders one chip
 * per invitation without combining nullable timestamps client-side.
 */
export async function listGroupInvitations(
  input: ListGroupInvitationsInput,
  deps: ListGroupInvitationsDeps,
): Promise<readonly GroupInvitationView[]> {
  await loadInvitationAuthority(input.actor, input.groupId, deps);

  const pending = await deps.groups.listPendingInvitations(input.groupId, input.now);
  // Resolve approved-email status per row in parallel; the allowlist is
  // a small private set so the cost is negligible.
  return Promise.all(
    pending.map(async (invitation) => {
      const isEmailApproved =
        invitation.email === null ? true : await deps.policy.isEmailApproved(invitation.email);
      return {
        invitation,
        status: invitationStatus(invitation, isEmailApproved, input.now.getTime()),
      };
    }),
  );
}
