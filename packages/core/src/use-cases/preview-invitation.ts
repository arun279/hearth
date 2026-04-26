import { DomainError, type GroupInvitationStatus, invitationStatus } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  StudyGroupRepository,
} from "@hearth/ports";

export type PreviewInvitationInput = {
  readonly token: string;
  readonly now: Date;
};

export type PreviewInvitationDeps = {
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly settings: InstanceSettingsRepository;
};

export type PreviewInvitationResult = {
  /**
   * The instance name is included so the unauthenticated landing can
   * render the "you're being invited to {groupName} on {instanceName}"
   * framing — without it, the SPA's invite landing pages have no
   * context, which feels like the user has left the product entirely.
   */
  readonly instanceName: string;
  readonly groupName: string;
  readonly inviterDisplayName: string | null;
  readonly targetEmail: string | null;
  readonly status: GroupInvitationStatus;
};

/**
 * Unauthenticated read-only preview for the consume landing. Returns just
 * enough to render the right copy (group name + invitee + status); the
 * full invitation object is never exposed publicly because the token is
 * the credential.
 *
 * Anyone with the token can read this — it's the same authority the
 * eventual consume call would carry. We deliberately don't shorten the
 * token in the URL or rotate it server-side; the 14-day expiry plus
 * single-use consume keep the blast radius narrow.
 */
export async function previewInvitation(
  input: PreviewInvitationInput,
  deps: PreviewInvitationDeps,
): Promise<PreviewInvitationResult> {
  const invitation = await deps.groups.invitationByToken(input.token);
  if (!invitation) {
    throw new DomainError("NOT_FOUND", "Invitation not found.", "invitation_not_found");
  }

  const [group, isEmailApproved, settings] = await Promise.all([
    deps.groups.byId(invitation.groupId),
    invitation.email === null
      ? Promise.resolve(true)
      : deps.policy.isEmailApproved(invitation.email),
    deps.settings.get(),
  ]);
  if (!group) {
    // Should not happen — the invitation has an FK to the group — but
    // surface as not-found rather than 500 for graceful degradation.
    throw new DomainError("NOT_FOUND", "Invitation's group is missing.", "invitation_not_found");
  }

  return {
    instanceName: settings?.name ?? "Hearth",
    groupName: group.name,
    // The preview is unauthenticated, so we deliberately do NOT join in
    // the inviter's user record. Rendering "an admin" is sufficient and
    // avoids leaking any name to anyone holding a token.
    inviterDisplayName: null,
    targetEmail: invitation.email,
    status: invitationStatus(invitation, isEmailApproved, input.now.getTime()),
  };
}
