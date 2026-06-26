import type { UserId } from "./ids.ts";

export type AttributionPreference = "preserve_name" | "anonymize";

export type User = {
  readonly id: UserId;
  readonly email: string | null;
  readonly name: string | null;
  readonly image: string | null;
  readonly deactivatedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly attributionPreference: AttributionPreference;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export function isActiveUser(user: User): boolean {
  return user.deactivatedAt === null && user.deletedAt === null;
}
