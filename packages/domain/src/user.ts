import type { UserId } from "./ids.ts";
import type { VisibilityPreference } from "./visibility/preference.ts";

export type AttributionPreference = "preserve_name" | "anonymize";

export type User = {
  readonly id: UserId;
  readonly email: string | null;
  readonly name: string | null;
  readonly image: string | null;
  readonly deactivatedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly attributionPreference: AttributionPreference;
  /**
   * The user's default Activity Record visibility, applied to any record
   * whose per-record override is NULL. Read-only here: the setter (and its
   * `/me/preferences` route) is the User Lifecycle milestone's, paired with
   * `attributionPreference`. Defaults to `default` when the stored column is
   * NULL.
   */
  readonly visibilityPreference: VisibilityPreference;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export function isActiveUser(user: User): boolean {
  return user.deactivatedAt === null && user.deletedAt === null;
}
