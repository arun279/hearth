import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { UserId } from "@hearth/domain";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createInstanceSettingsRepository } from "../../src/instance-settings-repository.ts";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Confirms the singleton row is seeded by migration `0002_instance_settings_seed`
 * and that `update` mutates it in place; CHECK constraint prevents a second
 * row from ever being inserted.
 */
describe("instance settings adapter (real D1)", () => {
  async function seedActor(db: ReturnType<typeof drizzle<typeof schema>>) {
    const actorId = "u_settings_actor" as UserId;
    const now = new Date();
    await db.insert(schema.users).values({
      id: actorId,
      email: "actor@x.com",
      emailVerified: false,
      name: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
    return actorId;
  }

  function buildRepo() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return { db, settings: createInstanceSettingsRepository({ db, gate }) };
  }

  it("returns the seeded singleton", async () => {
    const { settings } = buildRepo();
    const row = await settings.get();
    expect(row?.name).toBe("Hearth");
    expect(row?.updatedBy).toBeNull();
  });

  it("update mutates the singleton and echoes the new row", async () => {
    const { db, settings } = buildRepo();
    const actor = await seedActor(db);
    const next = await settings.update({ name: "Tuesday Night Learners" }, actor);
    expect(next.name).toBe("Tuesday Night Learners");
    expect(next.updatedBy).toBe(actor);

    const reread = await settings.get();
    expect(reread?.name).toBe("Tuesday Night Learners");
  });

  it("a second insert into instance_settings is rejected by the singleton CHECK", async () => {
    const { db } = buildRepo();
    await expect(
      db.insert(schema.instanceSettings).values({
        id: "rogue",
        name: "Rogue",
        updatedAt: new Date(),
        updatedBy: null,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
