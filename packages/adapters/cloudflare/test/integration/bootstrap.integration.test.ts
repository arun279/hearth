import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { UserId } from "@hearth/domain";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createInstanceAccessPolicyRepository } from "../../src/instance-access-policy-repository.ts";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * `bootstrapIfNeeded` MUST be atomic — the bootstrap operator sign-in
 * seeds two rows (`approved_emails` + `instance_operators`) and a partial
 * success would leave the instance in a state where the email is approved
 * but no one owns operator rights, or vice versa. Mocks can't catch this;
 * real D1 can.
 *
 * The seed is declarative + idempotent: while the env var matches the
 * candidate's email, repeated calls remain no-ops via the unique PKs.
 * The op count is not a guard — multiple operators are supported and
 * re-running the seed after a wipe must succeed.
 */
describe("bootstrapIfNeeded (real D1)", () => {
  async function seedUser(
    db: ReturnType<typeof drizzle<typeof schema>>,
    id: string,
    email: string,
  ) {
    const now = new Date();
    await db.insert(schema.users).values({
      id,
      email,
      emailVerified: false,
      name: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  function buildRepo() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return { db, policy: createInstanceAccessPolicyRepository({ db, gate }) };
  }

  it("seeds approved_emails + instance_operators atomically in one batch", async () => {
    const { db, policy } = buildRepo();
    const uid = "u_bootstrap_1" as UserId;
    await seedUser(db, uid, "op@example.com");

    const outcome = await policy.bootstrapIfNeeded({
      candidateEmail: "OP@Example.com",
      bootstrapEmail: "op@example.com",
      candidateUserId: uid,
    });

    expect(outcome).toEqual({ kind: "seeded", operatorUserId: uid });
    expect(await policy.isEmailApproved("op@example.com")).toBe(true);
    expect(await policy.countActiveOperators()).toBe(1);

    const approved = await policy.getApprovedEmail("op@example.com");
    expect(approved?.note).toBe("Bootstrap operator auto-seed");
  });

  it("is idempotent — a second call for the same bootstrap email is a no-op write", async () => {
    const { db, policy } = buildRepo();
    const uid = "u_bootstrap_2" as UserId;
    await seedUser(db, uid, "op@example.com");

    const first = await policy.bootstrapIfNeeded({
      candidateEmail: "op@example.com",
      bootstrapEmail: "op@example.com",
      candidateUserId: uid,
    });
    expect(first).toEqual({ kind: "seeded", operatorUserId: uid });
    expect(await policy.countActiveOperators()).toBe(1);

    const second = await policy.bootstrapIfNeeded({
      candidateEmail: "op@example.com",
      bootstrapEmail: "op@example.com",
      candidateUserId: uid,
    });
    expect(second).toEqual({ kind: "seeded", operatorUserId: uid });
    expect(await policy.countActiveOperators()).toBe(1);
    // The unique-PK guards mean the original rows persist unchanged.
    expect(await policy.isEmailApproved("op@example.com")).toBe(true);
  });

  it("rejects candidates whose email does not match the bootstrap email", async () => {
    const { db, policy } = buildRepo();
    const uid = "u_bootstrap_3" as UserId;
    await seedUser(db, uid, "stranger@example.com");

    const outcome = await policy.bootstrapIfNeeded({
      candidateEmail: "stranger@example.com",
      bootstrapEmail: "op@example.com",
      candidateUserId: uid,
    });

    expect(outcome).toEqual({ kind: "not_eligible" });
    expect(await policy.countActiveOperators()).toBe(0);
    expect(await policy.isEmailApproved("stranger@example.com")).toBe(false);
  });

  it("seeds even when other operators already exist (recovery after admission-row wipe)", async () => {
    const { db, policy } = buildRepo();
    const existing = "u_bootstrap_4_existing" as UserId;
    const bootstrap = "u_bootstrap_4_bootstrap" as UserId;
    const now = new Date();
    await seedUser(db, existing, "alice@example.com");
    await seedUser(db, bootstrap, "op@example.com");
    // Pre-existing operator unrelated to the bootstrap email — the same
    // shape as a local-dev DB where `local-session --seed` created a
    // test operator, then the bootstrap operator's admission rows got
    // wiped. The declarative bootstrap branch must still seed.
    await db.insert(schema.instanceOperators).values({
      userId: existing,
      grantedAt: now,
      grantedBy: existing,
      revokedAt: null,
    });

    const outcome = await policy.bootstrapIfNeeded({
      candidateEmail: "op@example.com",
      bootstrapEmail: "op@example.com",
      candidateUserId: bootstrap,
    });

    expect(outcome).toEqual({ kind: "seeded", operatorUserId: bootstrap });
    expect(await policy.countActiveOperators()).toBe(2);
    expect(await policy.isEmailApproved("op@example.com")).toBe(true);
  });
});
