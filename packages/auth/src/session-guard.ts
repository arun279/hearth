import { DomainError, isActiveUser } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";

/**
 * Wire into Better Auth's `session.create.before`. Defense in depth: rejects
 * sessions for deactivated/deleted users or users whose email was
 * subsequently revoked from the Approved Email list.
 */
export function createSessionGuard(policy: InstanceAccessPolicyRepository, users: UserRepository) {
  return async function sessionGuard(userId: string): Promise<void> {
    const user = await users.byId(userId as Parameters<UserRepository["byId"]>[0]);
    if (!user) {
      throw new DomainError("NOT_FOUND", "User not found.");
    }
    if (!isActiveUser(user)) {
      throw new DomainError("FORBIDDEN", "User is deactivated or deleted.", "user_inactive");
    }
    if (user.email && !(await policy.isEmailApproved(user.email))) {
      throw new DomainError(
        "FORBIDDEN",
        "This user's email is no longer approved for this Hearth Instance.",
        "email_revoked",
      );
    }
  };
}
