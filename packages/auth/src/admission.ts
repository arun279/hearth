import { DomainError } from "@hearth/domain";
import type { InstanceAccessPolicyRepository } from "@hearth/ports";

/**
 * Canonical email normalization — every caller must agree on casing/whitespace.
 */
export function canonicalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Wire into Better Auth's `databaseHooks.user.create.before`. Admits the
 * candidate iff either (a) their email is on the Approved Email list, or
 * (b) this is the first-operator bootstrap path: the instance has zero
 * active operators AND the candidate's email matches the configured
 * bootstrap operator email.
 *
 * Why the bootstrap-bypass lives here: Better Auth fires
 * `session.create.before` during the same transaction as the user insert,
 * while `user.create.after` is deferred until after commit. That means the
 * after-hook cannot seed approved_emails before the session guard's
 * admission re-check runs. Without this bypass, the first-ever operator
 * sign-in on a fresh instance would be rejected by the session guard.
 */
export async function admissionCheck(
  policy: InstanceAccessPolicyRepository,
  rawEmail: string,
  bootstrapOperatorEmail: string,
): Promise<void> {
  const email = canonicalizeEmail(rawEmail);
  const bootstrap = canonicalizeEmail(bootstrapOperatorEmail);

  if (await policy.isEmailApproved(email)) return;

  if (email.length > 0 && email === bootstrap) {
    const activeOperators = await policy.countActiveOperators();
    if (activeOperators === 0) return;
  }

  throw new DomainError(
    "FORBIDDEN",
    "This email is not approved for this Hearth Instance.",
    "email_not_approved",
  );
}
