export type DomainErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVARIANT_VIOLATION"
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

export type PolicyDenialReason = {
  readonly code: string;
  readonly message: string;
};

export type PolicyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PolicyDenialReason };

export const policyAllow = (): PolicyResult => ({ ok: true });

export const policyDeny = (code: string, message: string): PolicyResult => ({
  ok: false,
  reason: { code, message },
});
