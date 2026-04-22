import {
  createActivityRecordRepository,
  createClock,
  createDrizzleAdapter,
  createIdGenerator,
  createInstanceAccessPolicyRepository,
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
import { type AppBindings, createApiRouter } from "@hearth/api";
import { createAuth } from "@hearth/auth";
import { parseEnv } from "@hearth/config";
import { Hono } from "hono";

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

  const policy = createInstanceAccessPolicyRepository({ db });
  const users = createUserRepository({ db });

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

  c.set("userId", null);
  c.set("auth", auth);
  c.set("ports", {
    policy,
    users,
    groups: createStudyGroupRepository({ db }),
    tracks: createLearningTrackRepository({ db }),
    libraryItems: createLibraryItemRepository({ db, storage }),
    activities: createLearningActivityRepository({ db }),
    records: createActivityRecordRepository({ db }),
    sessions: createStudySessionRepository({ db }),
    storage: createObjectStorage(storage),
    flags: createSystemFlagRepository({ db }),
    clock: createClock(),
    ids: createIdGenerator(),
  });

  await next();
});

app.on(["GET", "POST"], "/api/auth/*", (c) => c.var.auth.handler(c.req.raw));

app.get("/healthz", (c) => c.text("ok"));

app.route("/api/v1", createApiRouter());

/**
 * Static asset fallthrough is handled by the ASSETS binding for any path
 * not matched above.
 *
 * The Worker exports both `fetch` and `scheduled` so the hourly usage-poll
 * cron declared in `wrangler.jsonc [triggers] crons` has a handler to invoke.
 */
const scheduler = createScheduler();

const worker: ExportedHandler<WorkerEnv> = {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => {
    // Register cron tasks on first invocation. Keeping this in the handler
    // scope avoids top-level mutation; Workers isolates are short-lived.
    await scheduler.dispatch(event.cron, new Date(event.scheduledTime));
    // `env` + `ctx` reserved for future cron handlers that need bindings.
    void env;
    void ctx;
  },
};

export default worker;
