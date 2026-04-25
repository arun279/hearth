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
  createScheduler,
  createStudyGroupRepository,
  createStudySessionRepository,
  createSystemFlagRepository,
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
    storage: createObjectStorage(storage, gate),
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

// HSTS on every HTTPS response. Defense in depth against the case where
// Cloudflare's "Always Use HTTPS" is disabled and a browser ends up cached
// onto http://hearth.wiki — the page loads, the SPA POSTs `/api/auth/sign-in/social`,
// the request carries `Origin: http://hearth.wiki`, better-auth rejects it
// with 403 INVALID_ORIGIN. Once a browser has seen STS once over HTTPS it
// auto-upgrades all subsequent navigations for `max-age` seconds, breaking
// the loop without a CF dashboard change. The header is meaningless over
// plain HTTP and browsers ignore it there, so the protocol gate is just to
// avoid emitting a no-op header.
app.use("*", async (c, next) => {
  await next();
  if (new URL(c.req.url).protocol === "https:") {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
});

// Rate-limit auth endpoints per-IP and /api/v1 writes per-session via
// Cloudflare's edge counter (no D1/KV/DO writes — see docs/free-tier-guardrails.md).
app.use("/api/auth/*", authRateLimit());
// Capture anomalous responses from Better Auth to Sentry. Origin-check
// failures (INVALID_ORIGIN, MISSING_OR_NULL_ORIGIN, INVALID_CALLBACK_URL,
// CROSS_SITE_NAVIGATION_LOGIN_BLOCKED) all surface as 403 with no other
// trail in Workers logs once the Worker version rotates — having the code,
// the request origin, and the path on a Sentry event is what makes a
// "Sign-in initiation failed (403)" report diagnosable. 401 is excluded
// because "no session yet" is a normal response on this prefix.
app.use("/api/auth/*", async (c, next) => {
  await next();
  const res = c.res;
  if (res.status < 400 || res.status === 401) return;
  const text = await res
    .clone()
    .text()
    .catch(() => "");
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text) as { code?: unknown };
    if (typeof parsed.code === "string") code = parsed.code;
  } catch {
    // Better Auth always returns JSON; a non-JSON body means the failure
    // came from upstream (CF, our own middleware) and the status alone is
    // the signal.
  }
  Sentry.captureMessage("auth_endpoint_failure", {
    level: res.status >= 500 ? "error" : "warning",
    extra: {
      method: c.req.method,
      path: c.req.path,
      status: res.status,
      code,
      origin: c.req.header("origin") ?? null,
      referer: c.req.header("referer") ?? null,
      hasCookie: c.req.header("cookie") !== undefined,
      bodyPreview: text.slice(0, 500),
    },
  });
});
app.on(["GET", "POST"], "/api/auth/*", (c) => c.var.auth.handler(c.req.raw));

app.use("/api/v1/*", writeRateLimit());
app.route("/api/v1", createApiRouter());

/**
 * Static asset fallthrough is handled by the ASSETS binding for any path
 * not matched above.
 *
 * The Worker exports both `fetch` and `scheduled` so the hourly usage-poll
 * cron declared in `wrangler.jsonc [triggers] crons` has a handler to invoke.
 */
const scheduler = createScheduler();

const handler: ExportedHandler<WorkerEnv> = {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => {
    // Register cron tasks on first invocation. Keeping this in the handler
    // scope avoids top-level mutation; Workers isolates are short-lived.
    await scheduler.dispatch(event.cron, new Date(event.scheduledTime));
    // env + ctx are reserved for cron handlers that will need bindings when
    // the usage poller and backup-export cron land in later milestones.
    void env;
    void ctx;
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
