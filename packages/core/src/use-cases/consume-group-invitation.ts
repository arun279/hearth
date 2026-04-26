import {
  DomainError,
  type GroupMembership,
  type TrackEnrollment,
  type UserId,
} from "@hearth/domain";
import { canConsumeInvitation } from "@hearth/domain/policy/can-consume-invitation";
import type {
  ConsumeInvitationResult,
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

export type ConsumeGroupInvitationInput = {
  readonly actor: UserId;
  readonly token: string;
  readonly now: Date;
};

export type ConsumeGroupInvitationDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

export type ConsumeGroupInvitationResult = {
  readonly membership: GroupMembership;
  readonly enrollment: TrackEnrollment | null;
};

/**
 * Consume an invitation by token. The actor must be authenticated; the
 * canonical denial codes (`invitation_email_mismatch`,
 * `email_not_approved_yet`, `invitation_revoked`, `invitation_consumed`,
 * `invitation_expired`) round-trip to the SPA so the consume landing
 * renders distinct copy for each variant.
 *
 * On success the membership is created (or re-activated if the user was
 * previously a member). Track enrollment is skipped today; M5 widens the
 * adapter contract to also create the enrollment row when `trackId` is
 * non-null.
 */
export async function consumeGroupInvitation(
  input: ConsumeGroupInvitationInput,
  deps: ConsumeGroupInvitationDeps,
): Promise<ConsumeGroupInvitationResult> {
  const [actor, invitation] = await Promise.all([
    deps.users.byId(input.actor),
    deps.groups.invitationByToken(input.token),
  ]);
  if (!actor) {
    throw new DomainError("NOT_FOUND", "Actor not found.", "actor_not_found");
  }
  if (!invitation) {
    throw new DomainError("NOT_FOUND", "Invitation not found.", "invitation_not_found");
  }

  const isEmailApproved =
    invitation.email === null ? true : await deps.policy.isEmailApproved(invitation.email);

  const verdict = canConsumeInvitation(actor, invitation, isEmailApproved, input.now.getTime());
  if (!verdict.ok) {
    // Each terminal-state denial maps to CONFLICT (409); the email
    // mismatch and not-approved cases use FORBIDDEN (403) so the SPA
    // can render different copy without sniffing the code field.
    const code =
      verdict.reason.code === "invitation_email_mismatch" ||
      verdict.reason.code === "email_not_approved_yet"
        ? "FORBIDDEN"
        : "CONFLICT";
    throw new DomainError(code, verdict.reason.message, verdict.reason.code);
  }

  const result: ConsumeInvitationResult = await deps.groups.consumeInvitation({
    invitationId: invitation.id,
    userId: input.actor,
    now: input.now,
  });

  return result;
}
