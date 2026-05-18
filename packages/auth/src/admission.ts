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
 * (b) their email matches the configured bootstrap operator email.
 *
 * The bootstrap branch is *declarative*: while
 * `HEARTH_BOOTSTRAP_OPERATOR_EMAIL` is set, that email is always admitted
 * and `user.create.after` idempotently seeds `approved_emails` +
 * `instance_operators`. This survives admission-table wipes, test
 * seeding that occupies other operator slots, and rotation — the env
 * var is the lever, not a one-shot. Rotating it to a different email
 * shifts bootstrap rights to the new email; clearing it disables the
 * bypass entirely.
 *
 * Why the bypass coexists with `session.create.before`'s admission
 * re-check: `user.create.after` is deferred until after the user-insert
 * transaction commits, so the seed lands AFTER `session.create.before`
 * runs. Without the bypass in both hooks, the first sign-in of an
 * already-seeded email-revoked path would be rejected by the session
 * guard before the after-hook reseeds.
 */
export async function admissionCheck(
  policy: InstanceAccessPolicyRepository,
  rawEmail: string,
  bootstrapOperatorEmail: string,
): Promise<void> {
  const email = canonicalizeEmail(rawEmail);
  const bootstrap = canonicalizeEmail(bootstrapOperatorEmail);

  if (await policy.isEmailApproved(email)) return;

  if (email.length > 0 && email === bootstrap) return;

  throw new DomainError(
    "FORBIDDEN",
    "This email is not approved for this Hearth Instance.",
    "email_not_approved",
  );
}
