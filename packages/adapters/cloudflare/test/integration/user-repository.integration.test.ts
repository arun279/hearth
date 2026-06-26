import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { UserId } from "@hearth/domain";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";
import { createUserRepository } from "../../src/user-repository.ts";

/**
 * Real-D1 coverage for the M12 read of `users.visibility_preference_json`.
 * The column is a nullable JSON envelope (no CHECK constraint), so the
 * adapter must parse it — NULL resolves to the canonical `default`, an
 * explicit envelope resolves to its preference, and a malformed-but-present
 * value is a stored-invariant violation rather than a silent coercion.
 */
describe("user adapter — visibilityPreference read (real D1)", () => {
  function buildRepos() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return { db, users: createUserRepository({ db, gate }) };
  }

  type Db = ReturnType<typeof drizzle<typeof schema>>;

  async function seedUser(db: Db, id: string, visibilityPreferenceJson: string | null) {
    const now = new Date();
    await db.insert(schema.users).values({
      id,
      email: `${id}@x.com`,
      emailVerified: false,
      name: null,
      image: null,
      visibilityPreferenceJson,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("maps a NULL column to the default preference", async () => {
    const { db, users } = buildRepos();
    await seedUser(db, "u_vp_null", null);
    const user = await users.byId("u_vp_null" as UserId);
    expect(user?.visibilityPreference).toBe("default");
  });

  it("parses an explicit envelope to its stored preference", async () => {
    const { db, users } = buildRepos();
    await seedUser(db, "u_vp_private", JSON.stringify({ v: 1, data: { preference: "private" } }));
    const user = await users.byId("u_vp_private" as UserId);
    expect(user?.visibilityPreference).toBe("private");
  });

  it("throws INVARIANT_VIOLATION on a present-but-malformed envelope", async () => {
    const { db, users } = buildRepos();
    await seedUser(db, "u_vp_bad", JSON.stringify({ v: 1, data: { preference: "nope" } }));
    await expect(users.byId("u_vp_bad" as UserId)).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
      reason: "envelope_invalid",
    });
  });
});
