import type { BetterAuthOptions } from "better-auth";

/**
 * Static portion of our Better Auth configuration — the subset that affects
 * the generated DB schema (via `user.additionalFields`) and the cookie /
 * session lifecycle. Runtime-specific values (baseURL, secret, database,
 * OAuth credentials, trustedOrigins, databaseHooks) live in create-auth.ts
 * and are supplied by the caller; those don't influence schema generation.
 *
 * Separating this out gives the schema-drift CLI guard at
 * `scripts/check-auth.config.ts` a single source of truth for
 * additionalFields without duplicating the declarations — the runtime
 * auth instance and the CLI shim read the same object.
 */
export const authOptions = {
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
} satisfies Partial<BetterAuthOptions>;
