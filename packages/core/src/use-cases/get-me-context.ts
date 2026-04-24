import type { MeContext, MeContextInstance, MeContextUser, UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  UserRepository,
} from "@hearth/ports";

export type GetMeContextInput = {
  /** null for anonymous/unauthenticated requests */
  readonly userId: UserId | null;
};

export type GetMeContextDeps = {
  readonly users: UserRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly settings: InstanceSettingsRepository;
};

/**
 * Build the `MeContext` envelope returned by `GET /api/v1/me/context`.
 *
 * Costs: three indexed reads (user by id, operator count, instance-settings
 * singleton). Deliberately returns a versioned envelope so additive fields
 * can land in later milestones without breaking already-deployed SPA bundles.
 *
 * Memberships + enrollments are empty at this milestone; later milestones
 * populate them from the group and track aggregates when those land.
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

  const isOperator =
    user !== null && input.userId !== null ? await deps.policy.isOperator(input.userId) : false;

  const instance: MeContextInstance = {
    name: settings?.name ?? "Hearth",
    needsBootstrap: activeOperatorCount === 0,
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
      memberships: [],
      enrollments: [],
    },
  };
}
