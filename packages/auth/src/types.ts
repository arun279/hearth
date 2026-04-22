import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";

export type AuthEnvironment = {
  readonly baseURL: string;
  readonly trustedOrigins: readonly string[];
  readonly secret: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly bootstrapOperatorEmail: string;
};

export type AuthDeps = {
  readonly policy: InstanceAccessPolicyRepository;
  readonly users: UserRepository;
};
