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
      readonly flags: SystemFlagRepository;
      readonly clock: Clock;
      readonly ids: IdGenerator;
    };
  };
};
