import { DomainError } from "@hearth/domain";
import type { InstanceAccessPolicyRepository } from "@hearth/ports";

/**
 * Wire into Better Auth's `databaseHooks.user.create.before`. Rejects sign-in
 * when the authenticated email is not on the instance's Approved Email list.
 * Canonicalization (lowercase + trim) happens here so every caller agrees.
 */
export async function admissionCheck(
  policy: InstanceAccessPolicyRepository,
  rawEmail: string,
): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const approved = await policy.isEmailApproved(email);
  if (!approved) {
    throw new DomainError(
      "FORBIDDEN",
      "This email is not approved for this Hearth Instance.",
      "email_not_approved",
    );
  }
}
