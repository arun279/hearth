import { DomainError, type InvitationId, type StudyGroupId, type UserId } from "@hearth/domain";
import { canRevokeGroupInvitation } from "@hearth/domain/policy/can-revoke-group-invitation";
import type {
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type RevokeGroupInvitationInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly invitationId: InvitationId;
  readonly now: Date;
};

export type RevokeGroupInvitationDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Revoke an outstanding invitation. Idempotent — revoking an already-
 * revoked or already-consumed invitation succeeds silently. The use case
 * still gates the operation through `loadViewableGroup` so a non-member
 * cannot enumerate invitation ids by probing for 404 vs 403.
 */
export async function revokeGroupInvitation(
  input: RevokeGroupInvitationInput,
  deps: RevokeGroupInvitationDeps,
): Promise<void> {
  const { actor, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const [invitation, operator] = await Promise.all([
    deps.groups.invitationById(input.invitationId),
    deps.policy.getOperator(input.actor),
  ]);
  if (!invitation || invitation.groupId !== input.groupId) {
    throw new DomainError("NOT_FOUND", "Invitation not found.", "invitation_not_found");
  }

  const verdict = canRevokeGroupInvitation(actor, membership, operator);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  await deps.groups.revokeInvitation({ id: input.invitationId, by: input.actor, now: input.now });
}
