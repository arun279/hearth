import type {
  ActivityRecordRepository,
  Clock,
  IdGenerator,
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  KillswitchGate,
  LearningActivityRepository,
  LearningTrackRepository,
  LibraryItemRepository,
  ObjectStorage,
  StudyGroupRepository,
  StudySessionRepository,
  SystemFlagRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";

/**
 * Minimal shape of Cloudflare's Rate Limiting binding — kept local to the
 * API package so we don't transitively pull workers-types here.
 */
export type RateLimitHandle = {
  limit(opts: { readonly key: string }): Promise<{ readonly success: boolean }>;
};

/**
 * Hono Variables holding request-scoped ports + the Better Auth instance.
 * apps/worker sets these via middleware at the composition root; route
 * handlers read through `c.var`.
 *
 * `auth` is kept opaque (handler only) so `packages/api` doesn't
 * transitively import drizzle via better-auth types. The composition root
 * resolves the session up-front and publishes it as `c.var.userId`;
 * routes never need to call auth.getSession themselves.
 */
export type AuthHandle = {
  handler(request: Request): Promise<Response>;
};

export type AppBindings = {
  Variables: {
    /**
     * null when no authenticated session exists. The auth middleware
     * resolves the cookie session before routes run.
     */
    readonly userId: string | null;
    readonly auth: AuthHandle;
    readonly gate: KillswitchGate;
    /**
     * Bearer token gating the /admin endpoints. Compared in constant time by
     * the admin middleware; never logged.
     */
    readonly adminToken: string;
    /** Cloudflare Rate Limiting bindings (edge counter; no D1/KV/DO writes). */
    readonly writeLimiter: RateLimitHandle;
    readonly authLimiter: RateLimitHandle;
    /**
     * Server-side runtime config surfaced to routes. Today this is just
     * the R2 public read origin (joined with stored avatar / library
     * keys to render `<img src>`); future config strings the SPA needs
     * to know about land here too rather than as build-time env vars.
     */
    readonly config: {
      readonly r2PublicOrigin: string;
      /**
       * Per-instance R2 byte ceiling, in bytes. Overrides
       * `INSTANCE_R2_BYTE_BUDGET` from the domain when an operator wants
       * to tune the trip threshold without a code change. Optional;
       * absent defaults to the domain constant.
       */
      readonly libraryByteBudget?: number;
      /**
       * Trip ratio (0 < r ≤ 1) — fraction of `libraryByteBudget` at
       * which the killswitch fires. Defaults to the domain constant.
       */
      readonly libraryBudgetTripRatio?: number;
      /**
       * Dev-only R2 proxy enabled. When true, the worker mounts
       * `/api/v1/__r2/*` routes that mediate uploads against the
       * Miniflare R2 binding. Production leaves this false; the
       * adapter signs real S3-compat URLs.
       */
      readonly r2DevProxy?: boolean;
    };
    readonly ports: {
      readonly policy: InstanceAccessPolicyRepository;
      readonly settings: InstanceSettingsRepository;
      readonly users: UserRepository;
      readonly groups: StudyGroupRepository;
      readonly tracks: LearningTrackRepository;
      readonly libraryItems: LibraryItemRepository;
      readonly activities: LearningActivityRepository;
      readonly records: ActivityRecordRepository;
      readonly sessions: StudySessionRepository;
      readonly storage: ObjectStorage;
      readonly uploads: UploadCoordinationRepository;
      readonly flags: SystemFlagRepository;
      readonly clock: Clock;
      readonly ids: IdGenerator;
    };
  };
};
