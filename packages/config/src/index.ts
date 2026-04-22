import { z } from "zod";

/**
 * Shape of runtime environment bindings the Worker expects. Workers secrets
 * are validated once at composition time — a missing or malformed secret
 * fails the Worker at startup, not mid-request.
 */
export const EnvSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_TRUSTED_ORIGINS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  KILLSWITCH_TOKEN: z.string().min(32),
  HEARTH_BOOTSTRAP_OPERATOR_EMAIL: z.email(),

  SENTRY_DSN: z.url().optional(),
  DISCORD_WEBHOOK_URL: z.url().optional(),
});

type RawEnv = z.infer<typeof EnvSchema>;

declare const parsedEnvBrand: unique symbol;

/**
 * Branded return type from `parseEnv`. The brand means callers MUST assign
 * the parsed value to a variable — `parseEnv(c.env)` as a bare expression
 * statement is a type error, because the raw env does not satisfy this
 * type. This closes the class of bug where `parseEnv` is called for its
 * validation side effect only and the coerced/transformed fields are
 * silently thrown away.
 */
export type Env = RawEnv & { readonly [parsedEnvBrand]: true };

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data as Env;
}
