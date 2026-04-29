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

  /**
   * R2 S3-compatibility credentials for minting presigned PUT URLs from
   * the Worker. The R2 binding does not expose a presign helper, so the
   * adapter signs requests against the S3 API endpoint with these keys.
   * Endpoint is path-style: `https://{accountId}.r2.cloudflarestorage.com`.
   */
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  /**
   * Public origin the SPA reads avatar / library asset URLs from. Either
   * the bucket's public dev URL (`pub-…r2.dev`) or a custom domain bound
   * to the bucket. Stored URLs are joined with this origin at render time.
   */
  R2_PUBLIC_ORIGIN: z.url(),

  /**
   * Dev-only R2 proxy switch. Set to "1" / "true" in `.dev.vars` to
   * route presigned PUT and signed GET URLs through the Worker itself
   * (which then talks to the R2 binding via Miniflare's in-process
   * simulator). Production leaves this unset; the adapter signs real
   * S3-compatible URLs against Cloudflare R2.
   *
   * The flag exists because Miniflare's R2 simulator is binding-only —
   * it doesn't expose an S3 endpoint a browser can PUT to. Without this
   * proxy, every developer needs a real R2 bucket + account credentials
   * to exercise the upload pipeline locally, which makes the UX fork
   * silently invisible until production.
   */
  R2_DEV_PROXY: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
    .transform((v) => v === "1" || v === "true"),

  /**
   * Operator override for the per-instance R2 byte budget (in bytes).
   * Set to a small value (e.g. `100000000` ≈ 100 MB) in dev to
   * exercise the killswitch trip without uploading several GB.
   * Production typically leaves it unset; the domain default
   * (10 GB, free-tier ceiling) applies.
   */
  LIBRARY_R2_BYTE_BUDGET: z.coerce.number().int().positive().optional(),
  /**
   * Override for the trip ratio (default 0.8). Same dev / prod
   * semantics as the budget knob; valid range is (0, 1].
   */
  LIBRARY_R2_BUDGET_TRIP_RATIO: z.coerce.number().gt(0).max(1).optional(),

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
