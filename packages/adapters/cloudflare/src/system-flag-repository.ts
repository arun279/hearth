import { systemFlags } from "@hearth/db/schema";
import type { SystemFlagKey, SystemFlagRepository } from "@hearth/ports";
import { eq } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

/**
 * Adapter maps the port's opaque string `SystemFlagValue` onto the schema's
 * `valueJson` column. Callers are expected to JSON-encode at the port boundary
 * when storing structured values.
 */
export function createSystemFlagRepository(
  deps: Pick<CloudflareAdapterDeps, "db">,
): SystemFlagRepository {
  return {
    async get(key) {
      const rows = await deps.db
        .select()
        .from(systemFlags)
        .where(eq(systemFlags.key, key))
        .limit(1);
      return rows[0]?.valueJson ?? null;
    },
    async set(key, value) {
      const now = new Date();
      await deps.db
        .insert(systemFlags)
        .values({ key, valueJson: value, setAt: now })
        .onConflictDoUpdate({
          target: systemFlags.key,
          set: { valueJson: value, setAt: now },
        });
    },
    async list(prefix) {
      const rows = await deps.db.select().from(systemFlags);
      return rows
        .filter((r) => !prefix || r.key.startsWith(prefix))
        .map((r) => ({ key: r.key as SystemFlagKey, value: r.valueJson }));
    },
  };
}
