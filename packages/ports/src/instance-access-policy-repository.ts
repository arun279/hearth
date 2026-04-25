import type { ApprovedEmail, InstanceOperator, UserId } from "@hearth/domain";

export type ApprovedEmailPage = {
  readonly entries: readonly ApprovedEmail[];
  readonly nextCursor: string | null;
};

export type AddApprovedEmailResult = {
  readonly approvedEmail: ApprovedEmail;
  /** False when the email was already on the list; caller maps to 409. */
  readonly created: boolean;
};

export type AddOperatorResult = {
  readonly operator: InstanceOperator;
  /**
   * False when the target already had a current operator row; caller can
   * treat the write as a no-op. Re-granting a previously-revoked operator
   * surfaces `created: true` because a state transition (revoked → active)
   * did happen.
   */
  readonly created: boolean;
};

export type BootstrapOutcome =
  | { readonly kind: "seeded"; readonly operatorUserId: UserId }
  | { readonly kind: "not_needed" }
  | { readonly kind: "not_eligible" };

export interface InstanceAccessPolicyRepository {
  // ── Approved Email roster ──────────────────────────────────────────────
  isEmailApproved(email: string): Promise<boolean>;
  listApprovedEmails(opts?: { cursor?: string; limit?: number }): Promise<ApprovedEmailPage>;
  addApprovedEmail(email: string, addedBy: UserId, note?: string): Promise<AddApprovedEmailResult>;
  removeApprovedEmail(email: string, removedBy: UserId): Promise<void>;
  getApprovedEmail(email: string): Promise<ApprovedEmail | null>;

  // ── Instance operator roster ───────────────────────────────────────────
  /**
   * Fetches the operator row for a user, including revoked ones. Callers use
   * `revokedAt === null` to determine current authority; returning revoked
   * rows lets use cases tell "never was an operator" from "was revoked."
   */
  getOperator(userId: UserId): Promise<InstanceOperator | null>;
  isOperator(userId: UserId): Promise<boolean>;
  listOperators(): Promise<readonly InstanceOperator[]>;
  addOperator(userId: UserId, grantedBy: UserId): Promise<AddOperatorResult>;
  revokeOperator(userId: UserId, revokedBy: UserId): Promise<void>;
  /** Count of currently active (non-revoked) operators. Cheap indexed aggregate. */
  countActiveOperators(): Promise<number>;

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
