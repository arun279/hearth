import type { AttributionPreference, User, UserId } from "@hearth/domain";

export interface UserRepository {
  byId(id: UserId): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  deactivate(id: UserId, by: UserId): Promise<void>;
  reactivate(id: UserId): Promise<void>;
  deleteIdentity(id: UserId, attribution: AttributionPreference, by: UserId): Promise<void>;
  setAttributionPreference(id: UserId, pref: AttributionPreference): Promise<void>;
}
