import type { ApprovedEmail, UserId } from "@hearth/domain";

export type ApprovedEmailPage = {
  readonly entries: readonly ApprovedEmail[];
  readonly nextCursor: string | null;
};

export type BootstrapOutcome =
  | { readonly kind: "seeded"; readonly operatorUserId: UserId }
  | { readonly kind: "not_needed" }
  | { readonly kind: "not_eligible" };

export interface InstanceAccessPolicyRepository {
  isEmailApproved(email: string): Promise<boolean>;
  listApprovedEmails(opts?: { cursor?: string; limit?: number }): Promise<ApprovedEmailPage>;
  addApprovedEmail(email: string, addedBy: UserId, note?: string): Promise<ApprovedEmail>;
  removeApprovedEmail(email: string, removedBy: UserId): Promise<void>;
  getApprovedEmail(email: string): Promise<ApprovedEmail | null>;

  /**
   * One-shot seed: atomically inserts into approved_emails + instance_operators
   * iff there are zero current operators AND the candidate email matches the
   * configured bootstrap email. Idempotent — concurrent races resolve via the
   * unique constraint on instance_operators.userId.
   */
  bootstrapIfNeeded(args: {
    readonly candidateEmail: string;
    readonly bootstrapEmail: string;
    readonly candidateUserId: UserId;
  }): Promise<BootstrapOutcome>;
}
