import {
  createActivityRecordRepository,
  createClock,
  createDrizzleAdapter,
  createIdGenerator,
  createInstanceAccessPolicyRepository,
  createInstanceSettingsRepository,
  createKillswitchGate,
  createLearningActivityRepository,
  createLearningTrackRepository,
  createLibraryItemRepository,
  createObjectStorage,
  createPendingUploadsSweep,
  createScheduler,
  createStudyGroupRepository,
  createStudySessionRepository,
  createSystemFlagRepository,
  createUploadCoordinationRepository,
  createUserRepository,
} from "@hearth/adapter-cloudflare";
import {
  type AppBindings,
  authRateLimit,
  createApiRouter,
  killswitchMiddleware,
  writeRateLimit,
} from "@hearth/api";
import { createAuth } from "@hearth/auth";
import { parseEnv } from "@hearth/config";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { logger } from "hono/logger";

export type WorkerEnv = {
  DB: D1Database;
  STORAGE: R2Bucket;
  ASSETS: Fetcher;
  ANALYTICS: AnalyticsEngineDataset;
  WRITE_LIMITER: RateLimit;
  AUTH_LIMITER: RateLimit;

  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_TRUSTED_ORIGINS: string;
  KILLSWITCH_TOKEN: string;
  HEARTH_BOOTSTRAP_OPERATOR_EMAIL: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_PUBLIC_ORIGIN: string;
  SENTRY_DSN?: string;
  DISCORD_WEBHOOK_URL?: string;
};

const app = new Hono<{ Bindings: WorkerEnv } & AppBindings>();

app.use("*", async (c, next) => {
  const env = parseEnv(c.env as unknown as Record<string, unknown>);
  const { db, authDatabase } = createDrizzleAdapter(c.env.DB);
  const storage = c.env.STORAGE;

  // Flags repo first: the killswitch gate reads through it, so it has to be
  // constructible before the gate.
  const flags = createSystemFlagRepository({ db });
  const gate = createKillswitchGate(flags);

  const policy = createInstanceAccessPolicyRepository({ db, gate });
  const settings = createInstanceSettingsRepository({ db, gate });
  const users = createUserRepository({ db, gate });

  const auth = createAuth({
    database: authDatabase,
    policy,
    users,
    env: {
      baseURL: env.BETTER_AUTH_URL,
      trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,
      secret: env.BETTER_AUTH_SECRET,
      googleClientId: env.GOOGLE_OAUTH_CLIENT_ID,
      googleClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      bootstrapOperatorEmail: env.HEARTH_BOOTSTRAP_OPERATOR_EMAIL,
    },
  });

  // Resolve the authenticated session from the Better Auth cookie up-front so
  // every downstream layer — route handlers, rate-limit keying, get-me-context
  // use case — can trust `c.var.userId`. A missing/invalid cookie or a
  // thrown error collapses to null; routes that require auth enforce it
  // themselves.
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  const userId = session?.user?.id ?? null;

  c.set("userId", userId);
  c.set("auth", { handler: (req: Request) => auth.handler(req) });
  c.set("gate", gate);
  c.set("adminToken", env.KILLSWITCH_TOKEN);
  c.set("writeLimiter", c.env.WRITE_LIMITER);
  c.set("authLimiter", c.env.AUTH_LIMITER);
  c.set("config", { r2PublicOrigin: env.R2_PUBLIC_ORIGIN });
  c.set("ports", {
    policy,
    settings,
    users,
    groups: createStudyGroupRepository({ db, gate }),
    tracks: createLearningTrackRepository({ db, gate }),
    libraryItems: createLibraryItemRepository({ db, storage, gate }),
    activities: createLearningActivityRepository({ db, gate }),
    records: createActivityRecordRepository({ db, gate }),
    sessions: createStudySessionRepository({ db, gate }),
    storage: createObjectStorage(storage, gate, {
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: "hearth-storage",
      // 15-minute ceiling for presigned PUTs. R2/S3 caps at 7 days; we
      // pick lower to limit blast radius if a URL leaks.
      maxExpirySeconds: 900,
    }),
    uploads: createUploadCoordinationRepository({ db, gate }),
    flags,
    clock: createClock(),
    ids: createIdGenerator(),
  });

  await next();
});

// /healthz is an unauthenticated liveness probe. Install BEFORE the killswitch
// middleware so it stays reachable in disabled mode (uptime checks must keep
// working even when the instance is shut off for everyone else).
app.get("/healthz", (c) => c.text("ok"));

app.use("*", killswitchMiddleware());
app.use("*", logger());

// Rate-limit auth endpoints per-IP and /api/v1 writes per-session via
// Cloudflare's edge counter (no D1/KV/DO writes — see docs/free-tier-guardrails.md).
app.use("/api/auth/*", authRateLimit());
app.on(["GET", "POST"], "/api/auth/*", (c) => c.var.auth.handler(c.req.raw));

app.use("/api/v1/*", writeRateLimit());
app.route("/api/v1", createApiRouter());

/**
 * Static asset fallthrough is handled by the ASSETS binding for any path
 * not matched above.
 *
 * The Worker exports both `fetch` and `scheduled` so the hourly cron
 * declared in `wrangler.jsonc [triggers] crons` has a handler to invoke.
 * The scheduler is constructed per cron firing so each invocation builds
 * its own bindings against the (per-isolate) `env`. Hand-rolling the
 * cron loop here — instead of relying on a long-lived module-scope
 * scheduler — matches Workers isolate semantics: fresh per request.
 */
const handler: ExportedHandler<WorkerEnv> = {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => {
    parseEnv(env as unknown as Record<string, unknown>);
    const { db } = createDrizzleAdapter(env.DB);
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);

    const scheduler = createScheduler();
    // Hourly sweep of orphaned `pending_uploads` rows: clears keys whose
    // presigned-PUT window expired without a finalize call. The sweep
    // calls `bucket.delete()` directly on the R2 binding (no presigning
    // needed) and uses the killswitch gate so a flipped instance stops
    // mutating R2 even from cron handlers.
    const sweep = createPendingUploadsSweep({ db, storage: env.STORAGE, gate });
    scheduler.registerCron("pending-uploads-sweep", "0 * * * *", async (at) => {
      // Drop the swept count — telemetry will live on the operator
      // health surface (M16). The cron handler signature is `void`.
      await sweep(at);
    });

    // ctx.waitUntil holds the isolate alive while async work finishes;
    // wrapping `dispatch` keeps the cron correctness invariant that all
    // scheduled work resolves before the cron event closes.
    ctx.waitUntil(scheduler.dispatch(event.cron, new Date(event.scheduledTime)));
  },
};

/**
 * Sentry wraps the entire Worker. When SENTRY_DSN is unset (local dev or
 * instances that opt out of Sentry) the client is constructed disabled —
 * no network calls, no overhead. `release` is populated by the CI deploy
 * workflow via Wrangler's version metadata when available.
 */
export default Sentry.withSentry(
  (env: WorkerEnv) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  }),
  handler,
);
