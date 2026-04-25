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
