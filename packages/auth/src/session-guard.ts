import { DomainError, isActiveUser, type UserId } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { canonicalizeEmail } from "./admission.ts";

/**
 * Wire into Better Auth's `session.create.before`. Defense in depth: rejects
 * sessions for deactivated/deleted users or users whose email was revoked
 * from the Approved Email list after initial sign-up.
 *
 * Bootstrap-bypass: `session.create.before` fires BEFORE the deferred
 * `user.create.after` hook (better-auth/better-auth#9070, PR #7345). That
 * ordering means during the first-operator sign-in flow, approved_emails
 * has NOT been seeded yet by the time we land here. Mirror the bypass from
 * admissionCheck so the first operator actually gets a session.
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

    // First-operator bootstrap race: approved_emails seed lands in
    // user.create.after, which runs AFTER session.create.before. Allow the
    // first operator through so the session can be established; the
    // after-hook then seeds both approved_emails and instance_operators.
    if (email.length > 0 && email === bootstrap) {
      const activeOperators = await policy.countActiveOperators();
      if (activeOperators === 0) return;
    }

    throw new DomainError(
      "FORBIDDEN",
      "This user's email is no longer approved for this Hearth Instance.",
      "email_revoked",
    );
  };
}
