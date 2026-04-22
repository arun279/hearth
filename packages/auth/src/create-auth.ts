import type { UserId } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admissionCheck } from "./admission.ts";
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
 * Hook wiring:
 *   - `databaseHooks.user.create.before` calls `admissionCheck()` — rejects
 *     any email not on the Approved Email list. Canonicalizes email here (the
 *     single point for trim + lowercase).
 *   - `databaseHooks.user.create.after` calls `bootstrapIfNeeded()` — seeds
 *     the first operator on first sign-in with the bootstrap email. Idempotent.
 *     Runs post-commit because the bootstrap FK targets the user row that
 *     only becomes visible after the insert commits.
 *   - `databaseHooks.session.create.before` runs `sessionGuard()` — defense
 *     in depth against admission changes after sign-up (deactivated/deleted
 *     users, revoked approved emails).
 */
export function createAuth(deps: AuthFactoryDeps) {
  const { database, policy, users, env } = deps;
  const sessionGuard = createSessionGuard(policy, users);

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
              await admissionCheck(policy, user.email);
            } catch {
              throw new APIError("FORBIDDEN", {
                message: "This email is not approved for this Hearth Instance.",
              });
            }
            return { data: { ...user, email: user.email.trim().toLowerCase() } };
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
