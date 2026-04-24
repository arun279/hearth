import type { UserId } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admissionCheck, canonicalizeEmail } from "./admission.ts";
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
 */
export function createAuth(deps: AuthFactoryDeps) {
  const { database, policy, users, env } = deps;
  const sessionGuard = createSessionGuard(policy, users, env.bootstrapOperatorEmail);

  return betterAuth({
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
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    user: {
      additionalFields: {
        deactivatedAt: { type: "date", required: false, input: false },
        deactivatedBy: { type: "string", required: false, input: false },
        deletedAt: { type: "date", required: false, input: false },
        deletedBy: { type: "string", required: false, input: false },
        attributionPreference: {
          type: "string",
          required: false,
          defaultValue: "preserve_name",
          input: false,
        },
        visibilityPreferenceJson: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            try {
              await admissionCheck(policy, user.email, env.bootstrapOperatorEmail);
            } catch {
              // Re-raise as APIError with the stable reason code so the SPA
              // can pattern-match on `?rejection=email_not_approved` in the
              // redirect query string. admissionCheck only throws this one
              // reason; more granular codes would live here if it didn't.
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
