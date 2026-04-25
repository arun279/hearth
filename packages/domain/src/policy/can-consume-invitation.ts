import { type PolicyResult, policyAllow, policyDeny } from "../errors.ts";
import type { GroupInvitation } from "../group.ts";
import { invitationStatus } from "../group-invariants.ts";
import type { User } from "../user.ts";

/**
 * Whether `actor` may consume the invitation. The actor must already be a
 * signed-in user; an existing membership is *not* required (the use case
 * idempotently no-ops in that case). The route also runs the upstream
 * email-approved check separately so the SPA can distinguish "your email
 * isn't approved yet" from generic 403.
 *
 * Returned denial codes round-trip cleanly to the SPA so each consume-
 * landing variant can render distinct copy.
 */
export function canConsumeInvitation(
  actor: User,
  invitation: GroupInvitation,
  isEmailApproved: boolean,
  nowMs: number,
): PolicyResult {
  // Email-targeted invitations bind the recipient. Comparing on the
  // canonicalized actor email keeps us aligned with the Approved Email
  // store, which always stores lowercase.
  if (invitation.email !== null) {
    const actorEmail = (actor.email ?? "").trim().toLowerCase();
    if (actorEmail.length === 0 || actorEmail !== invitation.email.trim().toLowerCase()) {
      return policyDeny(
        "invitation_email_mismatch",
        "This invitation was issued to a different email address.",
      );
    }
  }
  const status = invitationStatus(invitation, isEmailApproved, nowMs);
  switch (status) {
    case "revoked":
      return policyDeny("invitation_revoked", "This invitation has been revoked.");
    case "consumed":
      return policyDeny("invitation_consumed", "This invitation has already been used.");
    case "expired":
      return policyDeny("invitation_expired", "This invitation has expired.");
    case "pending_approval":
      return policyDeny(
        "email_not_approved_yet",
        "Your email isn't on the Approved list for this Hearth Instance yet. Ask an Instance Operator to approve it, then try again.",
      );
    case "pending":
      return policyAllow();
  }
}
