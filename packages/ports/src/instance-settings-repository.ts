import type { InstanceSettings, UserId } from "@hearth/domain";

export interface InstanceSettingsRepository {
  /**
   * Reads the singleton row. Adapter seeds the row during migration so this
   * never returns null in a properly provisioned instance; it returns null
   * only if the database was restored from a backup predating the seed.
   */
  get(): Promise<InstanceSettings | null>;
  update(patch: { readonly name: string }, updatedBy: UserId): Promise<InstanceSettings>;
}
