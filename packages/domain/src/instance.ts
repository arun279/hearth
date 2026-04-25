import type { UserId } from "./ids.ts";

export type InstanceSettings = {
  readonly name: string;
  readonly updatedAt: Date;
  readonly updatedBy: UserId | null;
};

export type ApprovedEmail = {
  readonly email: string;
  readonly addedBy: UserId;
  readonly addedAt: Date;
  readonly note: string | null;
};

export type InstanceOperator = {
  readonly userId: UserId;
  readonly grantedAt: Date;
  readonly grantedBy: UserId;
  readonly revokedAt: Date | null;
  /** UserId of whoever revoked this row; null on currently-active rows. */
  readonly revokedBy: UserId | null;
};

/**
 * Operator row plus the identity fields a UI needs to render a recognisable
 * label (name + email + avatar). The fields are nullable because Better
 * Auth's users table allows null and a user whose identity has been
 * scrubbed via deleteIdentity will surface here with all three null.
 */
export type InstanceOperatorWithIdentity = InstanceOperator & {
  readonly email: string | null;
  readonly name: string | null;
  readonly image: string | null;
};
