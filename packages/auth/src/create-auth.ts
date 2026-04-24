import type { UserId } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admissionCheck, canonicalizeEmail } from "./admission.ts";
import { authOptions } from "./auth-options.ts";
import { createSessionGuard } from "./session-guard.ts";
import type { AuthEnvironment } from "./types.ts";

export type AuthFactoryDeps = {
  readonly database: BetterAuthOptions["database"];
  readonly policy: InstanceAccessPolicyRepository;
  readonly users: UserRepository;
  readonly env: AuthEnvironment;
};

/**
 * Build a Better Auth instance wired to Hearth's admission + session policies.
 *
 * Hook wiring (order matters — see the bootstrap-bypass justification in
 * admission.ts and session-guard.ts):
 *   - `user.create.before` → admissionCheck. Rejects non-approved emails,
 *     with a bootstrap-bypass for the first operator. Canonicalizes email.
 *   - `session.create.before` → sessionGuard. Defense in depth. Carries the
 *     same bootstrap-bypass because this hook fires BEFORE the deferred
 *     `user.create.after` runs.
 *   - `user.create.after` → bootstrapIfNeeded. Runs post-commit and
 *     idempotently seeds approved_emails + instance_operators for the
 *     first-operator flow.
 *
 * Schema-affecting options (session config + user.additionalFields) live
 * in auth-options.ts so `scripts/check-auth.config.ts` can share them with
 * the Better Auth CLI generator — one source of truth, zero drift risk.
 */
export function createAuth(deps: AuthFactoryDeps) {
  const { database, policy, users, env } = deps;
  const sessionGuard = createSessionGuard(policy, users, env.bootstrapOperatorEmail);

  return betterAuth({
    ...authOptions,
    baseURL: env.baseURL,
    trustedOrigins: [...env.trustedOrigins],
    secret: env.secret,
    database,
    socialProviders: {
      google: {
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            try {
              await admissionCheck(policy, user.email, env.bootstrapOperatorEmail);
            } catch {
              throw new APIError("FORBIDDEN", {
                message: "This email is not approved for this Hearth Instance.",
                code: "email_not_approved",
              });
            }
            return { data: { ...user, email: canonicalizeEmail(user.email) } };
          },
          after: async (user) => {
            await policy.bootstrapIfNeeded({
              candidateEmail: user.email,
              bootstrapEmail: env.bootstrapOperatorEmail,
              candidateUserId: user.id as UserId,
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            try {
              await sessionGuard(session.userId);
            } catch {
              throw new APIError("FORBIDDEN", {
                message: "Session rejected by Hearth instance access policy.",
              });
            }
            return { data: session };
          },
        },
      },
    },
  });
}
