import type {
  ActivityRecordRepository,
  Clock,
  IdGenerator,
  InstanceAccessPolicyRepository,
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
 * Hono Variables holding request-scoped ports + the Better Auth instance.
 * apps/worker sets these via middleware at the composition root; route
 * handlers read through `c.var`.
 *
 * `auth` is typed as an opaque `{ handler: (req: Request) => Promise<Response> }`
 * so `packages/api` doesn't transitively import drizzle via better-auth types.
 */
export type AuthHandle = {
  handler(request: Request): Promise<Response>;
};

export type AppBindings = {
  Variables: {
    readonly userId: string | null;
    readonly auth: AuthHandle;
    readonly ports: {
      readonly policy: InstanceAccessPolicyRepository;
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
