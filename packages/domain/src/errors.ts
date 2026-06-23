export type DomainErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "INVARIANT_VIOLATION"
  | "INSUFFICIENT_STORAGE"
  | "READ_ONLY"
  | "DISABLED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly reason?: string;

  constructor(code: DomainErrorCode, message: string, reason?: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.reason = reason;
  }
}

/**
 * Stable wire codes emitted by `policyDeny()`. The SPA pattern-matches on
 * these in `apps/web/src/lib/problem.ts` to map a denial into a user-
 * facing phrase. Adding a new denial here forces TS to flag any
 * `policyDeny("foo", …)` whose literal isn't in the tuple, which in turn
 * surfaces the missing SPA message via the source-scan test that asserts
 * every code in this tuple has an entry in `policyDenialMessages`.
 */
export const POLICY_DENIAL_CODES = [
  "activity_window_closed",
  "already_revoked",
  "cannot_revoke_self",
  "email_not_approved_yet",
  "enrollment_requires_membership",
  "group_archived",
  "invitation_consumed",
  "invitation_email_mismatch",
  "invitation_expired",
  "invitation_revoked",
  "library_item_retired",
  "not_a_member",
  "not_facilitator",
  "not_group_admin",
  "not_group_member",
  "not_in_audience",
  "not_instance_operator",
  "not_library_steward",
  "not_record_owner",
  "not_self",
  "not_track_authority",
  "not_track_enrollee",
  "parts_incomplete",
  "prereq_not_met",
  "track_archived",
  "track_paused",
  "would_orphan_admin",
  "would_orphan_facilitator",
  "would_orphan_operator",
] as const;

export type PolicyDenialCode = (typeof POLICY_DENIAL_CODES)[number];

export type PolicyDenialReason = {
  readonly code: PolicyDenialCode;
  readonly message: string;
};

export type PolicyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PolicyDenialReason };

export const policyAllow = (): PolicyResult => ({ ok: true });

export const policyDeny = (code: PolicyDenialCode, message: string): PolicyResult => ({
  ok: false,
  reason: { code, message },
});
