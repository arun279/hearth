import { instanceSettings } from "@hearth/db/schema";
import type { InstanceSettings, UserId } from "@hearth/domain";
import type { InstanceSettingsRepository } from "@hearth/ports";
import { eq } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

const SINGLETON_ID = "instance";

function toSettings(r: typeof instanceSettings.$inferSelect): InstanceSettings {
  return {
    name: r.name,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy === null ? null : (r.updatedBy as UserId),
  };
}

export function createInstanceSettingsRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): InstanceSettingsRepository {
  return {
    async get() {
      const rows = await deps.db
        .select()
        .from(instanceSettings)
        .where(eq(instanceSettings.id, SINGLETON_ID))
        .limit(1);
      return rows[0] ? toSettings(rows[0]) : null;
    },
    async update(patch, updatedBy): Promise<InstanceSettings> {
      await deps.gate.assertWritable();
      const now = new Date();
      await deps.db
        .update(instanceSettings)
        .set({ name: patch.name, updatedAt: now, updatedBy })
        .where(eq(instanceSettings.id, SINGLETON_ID));
      return { name: patch.name, updatedAt: now, updatedBy };
    },
  };
}
