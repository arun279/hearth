import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { UserId } from "@hearth/domain";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createInstanceAccessPolicyRepository } from "../../src/instance-access-policy-repository.ts";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * `bootstrapIfNeeded` MUST be atomic — the first operator sign-in seeds two
 * rows (`approved_emails` + `instance_operators`) and a partial success would
 * leave the instance in a state where the email is approved but no one owns
 * operator rights, or vice versa. Mocks can't catch this; real D1 can.
 *
 * The test also asserts idempotency: a second call after the seed returns
 * `{ kind: "not_needed" }` without writing anything, and the rows remain
 * exactly as left.
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

  it("is a no-op once any operator exists (`not_needed`)", async () => {
    const { db, policy } = buildRepo();
    const first = "u_bootstrap_2a" as UserId;
    const second = "u_bootstrap_2b" as UserId;
    await seedUser(db, first, "one@example.com");
    await seedUser(db, second, "two@example.com");

    await policy.bootstrapIfNeeded({
      candidateEmail: "one@example.com",
      bootstrapEmail: "one@example.com",
      candidateUserId: first,
    });

    const second_outcome = await policy.bootstrapIfNeeded({
      candidateEmail: "two@example.com",
      bootstrapEmail: "two@example.com",
      candidateUserId: second,
    });

    expect(second_outcome).toEqual({ kind: "not_needed" });
    expect(await policy.countActiveOperators()).toBe(1);
    expect(await policy.isEmailApproved("two@example.com")).toBe(false);
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
});
