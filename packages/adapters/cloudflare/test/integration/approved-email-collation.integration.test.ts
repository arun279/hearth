import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { UserId } from "@hearth/domain";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createInstanceAccessPolicyRepository } from "../../src/instance-access-policy-repository.ts";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * `isEmailApproved` lowercases the input before looking up the approved-email
 * row; every writer also lowercases before insert. The pair is critical —
 * if a future edit drops canonicalization on one side, Gmail-style
 * case-variant emails would slip past the allowlist. Real SQLite exposes
 * this because its BINARY collation on a text PK is strict; an in-memory
 * mock wouldn't.
 */
describe("isEmailApproved collation (real D1)", () => {
  function buildRepo() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return { db, policy: createInstanceAccessPolicyRepository({ db, gate }) };
  }

  async function seedAdder(db: ReturnType<typeof drizzle<typeof schema>>) {
    const adder = "u_case_admin" as UserId;
    const now = new Date();
    await db.insert(schema.users).values({
      id: adder,
      email: "admin@example.com",
      emailVerified: false,
      name: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
    return adder;
  }

  it("matches on case-variant lookups after a lower-case insert", async () => {
    const { db, policy } = buildRepo();
    const adder = await seedAdder(db);

    await policy.addApprovedEmail("Member@Example.COM", adder);

    expect(await policy.isEmailApproved("member@example.com")).toBe(true);
    expect(await policy.isEmailApproved("MEMBER@EXAMPLE.COM")).toBe(true);
    expect(await policy.isEmailApproved("  member@example.com  ")).toBe(true);
  });

  it("does not match a different email even with case variance", async () => {
    const { db, policy } = buildRepo();
    const adder = await seedAdder(db);

    await policy.addApprovedEmail("only@example.com", adder);

    expect(await policy.isEmailApproved("other@example.com")).toBe(false);
    expect(await policy.isEmailApproved("Other@Example.COM")).toBe(false);
  });
});
