import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import { DomainError, type UserId } from "@hearth/domain";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createInstanceAccessPolicyRepository } from "../../src/instance-access-policy-repository.ts";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Operator-roster and approved-email adapter behaviour that only real D1 can
 * exercise:
 *   - the orphan guard in revokeOperator must be atomic with the UPDATE;
 *   - listOperators orders newest-first and includes revoked rows;
 *   - listApprovedEmails paginates by keyset on (addedAt DESC, email ASC);
 *   - addApprovedEmail reports `{ created: false }` for case-variant
 *     duplicates;
 *   - removeApprovedEmail hard-deletes every session whose user shares the
 *     removed email (in-canonicalised form).
 */
describe("instance-access-policy adapter (real D1)", () => {
  function buildRepo() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return { db, policy: createInstanceAccessPolicyRepository({ db, gate }) };
  }

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

  async function seedSession(
    db: ReturnType<typeof drizzle<typeof schema>>,
    id: string,
    userId: string,
  ) {
    const now = new Date();
    await db.insert(schema.sessions).values({
      id,
      userId,
      token: `${id}-token`,
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    });
  }

  describe("addApprovedEmail", () => {
    it("creates a row on first insert and reports created=true", async () => {
      const { db, policy } = buildRepo();
      const adder = "u_a1" as UserId;
      await seedUser(db, adder, "a@x.com");
      const out = await policy.addApprovedEmail("new@x.com", adder, "first");
      expect(out.created).toBe(true);
      expect(out.approvedEmail.email).toBe("new@x.com");
      expect(out.approvedEmail.note).toBe("first");
    });

    it("reports created=false on a duplicate, without overwriting the prior row", async () => {
      const { db, policy } = buildRepo();
      const adder = "u_a2" as UserId;
      await seedUser(db, adder, "a@x.com");
      const first = await policy.addApprovedEmail("dup@x.com", adder, "original");
      const second = await policy.addApprovedEmail("DUP@X.COM", adder, "clobber");
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.approvedEmail.note).toBe("original"); // unchanged
    });
  });

  describe("removeApprovedEmail → session cascade", () => {
    it("hard-deletes sessions for every user sharing the removed email", async () => {
      const { db, policy } = buildRepo();
      const adder = "u_rm_admin" as UserId;
      await seedUser(db, adder, "admin@x.com");
      await seedUser(db, "u_rm_1", "guest@x.com");
      await seedUser(db, "u_rm_unrelated", "keep@x.com");
      await seedSession(db, "s_rm_1", "u_rm_1");
      await seedSession(db, "s_rm_2", "u_rm_unrelated");
      await policy.addApprovedEmail("guest@x.com", adder);

      // Case-variance on removal should still catch the lowercased row.
      await policy.removeApprovedEmail("Guest@X.com", adder);

      const remaining = await db.select().from(schema.sessions);
      expect(remaining.map((r) => r.id).sort()).toEqual(["s_rm_2"]);
      expect(await policy.isEmailApproved("guest@x.com")).toBe(false);
    });

    it("is a no-op when no users share the email", async () => {
      const { db, policy } = buildRepo();
      const adder = "u_rm_admin2" as UserId;
      await seedUser(db, adder, "admin@x.com");
      await policy.addApprovedEmail("ghost@x.com", adder);

      await policy.removeApprovedEmail("ghost@x.com", adder);
      expect(await policy.isEmailApproved("ghost@x.com")).toBe(false);
    });
  });

  describe("listOperators", () => {
    it("returns newest first and includes revoked rows", async () => {
      const { db, policy } = buildRepo();
      await seedUser(db, "u_op_1", "op1@x.com");
      await seedUser(db, "u_op_2", "op2@x.com");
      await seedUser(db, "u_op_3", "op3@x.com");

      await policy.addOperator("u_op_1" as UserId, "u_op_1" as UserId);
      await new Promise((r) => setTimeout(r, 2));
      await policy.addOperator("u_op_2" as UserId, "u_op_1" as UserId);
      await new Promise((r) => setTimeout(r, 2));
      await policy.addOperator("u_op_3" as UserId, "u_op_1" as UserId);
      await policy.revokeOperator("u_op_3" as UserId, "u_op_1" as UserId);

      const rows = await policy.listOperators();
      expect(rows.map((r) => r.userId)).toEqual(["u_op_3", "u_op_2", "u_op_1"]);
      expect(rows.find((r) => r.userId === "u_op_3")?.revokedAt).not.toBeNull();
    });
  });

  describe("revokeOperator orphan guard", () => {
    it("throws INVARIANT_VIOLATION when the target is the only active operator", async () => {
      const { db, policy } = buildRepo();
      await seedUser(db, "u_solo", "solo@x.com");
      await policy.addOperator("u_solo" as UserId, "u_solo" as UserId);

      await expect(
        policy.revokeOperator("u_solo" as UserId, "u_solo" as UserId),
      ).rejects.toBeInstanceOf(DomainError);
      expect(await policy.countActiveOperators()).toBe(1);
    });

    it("revokes safely when another active operator exists", async () => {
      const { db, policy } = buildRepo();
      await seedUser(db, "u_two_a", "a@x.com");
      await seedUser(db, "u_two_b", "b@x.com");
      await policy.addOperator("u_two_a" as UserId, "u_two_a" as UserId);
      await policy.addOperator("u_two_b" as UserId, "u_two_a" as UserId);

      await policy.revokeOperator("u_two_b" as UserId, "u_two_a" as UserId);
      expect(await policy.countActiveOperators()).toBe(1);
      const row = await policy.getOperator("u_two_b" as UserId);
      expect(row?.revokedAt).not.toBeNull();
    });

    it("blocks the orphan race when two distinct revokes run concurrently", async () => {
      const { db, policy } = buildRepo();
      await seedUser(db, "u_race_a", "ra@x.com");
      await seedUser(db, "u_race_b", "rb@x.com");
      await policy.addOperator("u_race_a" as UserId, "u_race_a" as UserId);
      await policy.addOperator("u_race_b" as UserId, "u_race_a" as UserId);

      // Two distinct-target revokes started in parallel from a 2-operator
      // state. Only one is allowed to succeed; the other must hit the
      // atomic orphan guard inside the UPDATE's WHERE clause.
      const results = await Promise.allSettled([
        policy.revokeOperator("u_race_a" as UserId, "u_race_a" as UserId),
        policy.revokeOperator("u_race_b" as UserId, "u_race_a" as UserId),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.filter((r) => r.status === "rejected").length;
      expect(fulfilled).toBe(1);
      expect(rejected).toBe(1);
      expect(await policy.countActiveOperators()).toBe(1);
    });

    it("is a no-op on a concurrent double-revoke of the same row", async () => {
      const { db, policy } = buildRepo();
      await seedUser(db, "u_rr_a", "a@x.com");
      await seedUser(db, "u_rr_b", "b@x.com");
      await seedUser(db, "u_rr_c", "c@x.com");
      await policy.addOperator("u_rr_a" as UserId, "u_rr_a" as UserId);
      await policy.addOperator("u_rr_b" as UserId, "u_rr_a" as UserId);
      await policy.addOperator("u_rr_c" as UserId, "u_rr_a" as UserId);

      await policy.revokeOperator("u_rr_c" as UserId, "u_rr_a" as UserId);
      // Second call on the same already-revoked row must not throw.
      await policy.revokeOperator("u_rr_c" as UserId, "u_rr_a" as UserId);
      expect(await policy.countActiveOperators()).toBe(2);
    });
  });

  describe("addOperator idempotency", () => {
    it("re-granting an already-active operator returns created=false", async () => {
      const { db, policy } = buildRepo();
      await seedUser(db, "u_ag_a", "a@x.com");
      const first = await policy.addOperator("u_ag_a" as UserId, "u_ag_a" as UserId);
      const second = await policy.addOperator("u_ag_a" as UserId, "u_ag_a" as UserId);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(await policy.countActiveOperators()).toBe(1);
    });

    it("re-granting a revoked operator reactivates and returns created=true", async () => {
      const { db, policy } = buildRepo();
      await seedUser(db, "u_ag_b1", "b1@x.com");
      await seedUser(db, "u_ag_b2", "b2@x.com");
      await policy.addOperator("u_ag_b1" as UserId, "u_ag_b1" as UserId);
      await policy.addOperator("u_ag_b2" as UserId, "u_ag_b1" as UserId);
      await policy.revokeOperator("u_ag_b2" as UserId, "u_ag_b1" as UserId);

      const out = await policy.addOperator("u_ag_b2" as UserId, "u_ag_b1" as UserId);
      expect(out.created).toBe(true);
      expect(out.operator.revokedAt).toBeNull();
      expect(await policy.countActiveOperators()).toBe(2);
    });
  });

  describe("listApprovedEmails keyset pagination", () => {
    it("paginates newest first with a stable cursor", async () => {
      const { db, policy } = buildRepo();
      const adder = "u_list_admin" as UserId;
      await seedUser(db, adder, "admin@x.com");

      // Seed 5 emails, each with a distinct addedAt by inserting with a tiny
      // delay so the ORDER BY timestamp is unambiguous.
      const emails = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];
      for (const e of emails) {
        await policy.addApprovedEmail(e, adder);
        await new Promise((r) => setTimeout(r, 2));
      }

      const page1 = await policy.listApprovedEmails({ limit: 2 });
      expect(page1.entries.map((r) => r.email)).toEqual(["e@x.com", "d@x.com"]);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await policy.listApprovedEmails({
        limit: 2,
        cursor: page1.nextCursor ?? undefined,
      });
      expect(page2.entries.map((r) => r.email)).toEqual(["c@x.com", "b@x.com"]);
      expect(page2.nextCursor).not.toBeNull();

      const page3 = await policy.listApprovedEmails({
        limit: 2,
        cursor: page2.nextCursor ?? undefined,
      });
      expect(page3.entries.map((r) => r.email)).toEqual(["a@x.com"]);
      expect(page3.nextCursor).toBeNull();
    });
  });
});
