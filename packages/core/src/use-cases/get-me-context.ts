import type { MeContext, MeContextInstance, MeContextUser, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

export type GetMeContextInput = {
  /** null for anonymous/unauthenticated requests */
  readonly userId: UserId | null;
  /**
   * Worker-resolved public read origin for R2-stored assets. Plumbed in
   * from the route handler (which reads `env.R2_PUBLIC_ORIGIN`) rather
   * than being a use-case dep, because it's a runtime config string,
   * not a port. Threaded through `MeContext.instance` so the SPA reads
   * server-side truth instead of a build-time `import.meta.env` value
   * that can drift from the worker's configured bucket.
   */
  readonly r2PublicOrigin: string;
};

export type GetMeContextDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly settings: InstanceSettingsRepository;
  readonly groups: StudyGroupRepository;
};

/**
 * Build the `MeContext` envelope returned by `GET /api/v1/me/context`.
 *
 * Costs: four indexed reads (user, operator count, settings singleton, the
 * actor's active group memberships). The envelope is versioned so additive
 * fields (track enrollments in M5) land without breaking already-deployed
 * SPA bundles.
 */
export async function getMeContext(
  input: GetMeContextInput,
  deps: GetMeContextDeps,
): Promise<MeContext> {
  const [user, activeOperatorCount, settings] = await Promise.all([
    input.userId === null ? Promise.resolve(null) : deps.users.byId(input.userId),
    deps.policy.countActiveOperators(),
    deps.settings.get(),
  ]);

  const [isOperator, memberships] = await Promise.all([
    user !== null && input.userId !== null ? deps.policy.isOperator(input.userId) : false,
    user !== null && input.userId !== null
      ? deps.groups.membershipsForUser(input.userId)
      : Promise.resolve([] as const),
  ]);

  const instance: MeContextInstance = {
    name: settings?.name ?? "Hearth",
    needsBootstrap: activeOperatorCount === 0,
    r2PublicOrigin: input.r2PublicOrigin,
  };

  const meUser: MeContextUser | null =
    user === null || user.email === null
      ? null
      : { id: user.id, email: user.email, name: user.name, image: user.image };

  return {
    v: 1,
    data: {
      user: meUser,
      instance,
      isOperator,
      memberships,
      enrollments: [],
    },
  };
}
