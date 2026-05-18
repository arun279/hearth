import { DomainError, isActiveUser, type UserId } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { canonicalizeEmail } from "./admission.ts";

/**
 * Wire into Better Auth's `session.create.before`. Defense in depth: rejects
 * sessions for deactivated/deleted users or users whose email was revoked
 * from the Approved Email list after initial sign-up.
 *
 * Mirrors `admissionCheck`'s declarative bootstrap branch: while
 * `HEARTH_BOOTSTRAP_OPERATOR_EMAIL` is set, sessions for the matching
 * email are admitted regardless of the approved-email row's presence.
 * `user.create.after` is deferred until after the user-insert
 * transaction commits, so the seed lands AFTER `session.create.before`
 * runs; without this bypass the first session for any newly-seeded
 * bootstrap email would be rejected. The bypass also serves as the
 * recovery path when an `approved_emails` row gets dropped: the next
 * sign-in re-seeds via the same after-hook.
 */
export function createSessionGuard(
  policy: InstanceAccessPolicyRepository,
  users: UserRepository,
  bootstrapOperatorEmail: string,
) {
  const bootstrap = canonicalizeEmail(bootstrapOperatorEmail);

  return async function sessionGuard(userId: string): Promise<void> {
    const user = await users.byId(userId as UserId);
    if (!user) {
      throw new DomainError("NOT_FOUND", "User not found.");
    }
    if (!isActiveUser(user)) {
      throw new DomainError("FORBIDDEN", "User is deactivated or deleted.", "user_inactive");
    }
    if (!user.email) return;

    const email = canonicalizeEmail(user.email);
    if (await policy.isEmailApproved(email)) return;

    if (email.length > 0 && email === bootstrap) return;

    throw new DomainError(
      "FORBIDDEN",
      "This user's email is no longer approved for this Hearth Instance.",
      "email_revoked",
    );
  };
}
