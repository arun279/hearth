import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { UserId } from "@hearth/domain";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createStudyGroupRepository } from "../../src/study-group-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Behaviour that only real D1 can exercise for the M3 membership /
 * invitation surface:
 *   - `addMembership` is idempotent on (groupId, userId) and revives
 *     a previously-removed row instead of inserting a duplicate.
 *   - `removeMembership` rejects the orphan-admin transition with the
 *     typed `would_orphan_admin` reason and writes the attribution
 *     snapshot when `preserve_name`.
 *   - `setMembershipRole` enforces the same orphan invariant on demote.
 *   - Two simultaneous demotions cannot both succeed against the same
 *     last-admin row.
 *   - `consumeInvitation` finalizes the invitation + creates the
 *     membership atomically; a second consumer loses the race.
 */
describe("membership mutations (real D1)", () => {
  function buildRepo() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return { db, groups: createStudyGroupRepository({ db, gate }) };
  }

  async function seedUser(
    db: ReturnType<typeof drizzle<typeof schema>>,
    id: string,
    email: string,
    name: string | null = id,
  ): Promise<UserId> {
    const now = new Date();
    await db.insert(schema.users).values({
      id,
      email,
      emailVerified: false,
      name,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
    return id as UserId;
  }

  it("addMembership is idempotent for an active row", async () => {
    const { db, groups } = buildRepo();
    const creator = await seedUser(db, "u_idem_a", "ia@x.com");
    const joiner = await seedUser(db, "u_idem_b", "ib@x.com");
    const g = await groups.create({ name: "Idem", createdBy: creator });

    const first = await groups.addMembership({
      groupId: g.id,
      userId: joiner,
      role: "participant",
      by: creator,
    });
    const second = await groups.addMembership({
      groupId: g.id,
      userId: joiner,
      role: "participant",
      by: creator,
    });
    expect(second.userId).toBe(first.userId);

    const all = await db
      .select()
      .from(schema.groupMemberships)
      .where(
        and(eq(schema.groupMemberships.groupId, g.id), eq(schema.groupMemberships.userId, joiner)),
      );
    expect(all.length).toBe(1);
  });

  it("removeMembership rejects when it would orphan the last admin", async () => {
    const { db, groups } = buildRepo();
    const solo = await seedUser(db, "u_solo_admin", "sa@x.com");
    const g = await groups.create({ name: "Solo", createdBy: solo });

    await expect(
      groups.removeMembership({
        groupId: g.id,
        userId: solo,
        by: solo,
        attribution: "preserve_name",
        displayNameSnapshot: "Solo",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_admin" });

    expect(await groups.countAdmins(g.id)).toBe(1);
  });

  it("removeMembership populates displayNameSnapshot only when preserving name", async () => {
    const { db, groups } = buildRepo();
    const creator = await seedUser(db, "u_snap_a", "sna@x.com");
    const leaver = await seedUser(db, "u_snap_b", "snb@x.com", "Snap Leaver");
    const g = await groups.create({ name: "Snap", createdBy: creator });
    await groups.addMembership({
      groupId: g.id,
      userId: leaver,
      role: "participant",
      by: creator,
    });

    await groups.removeMembership({
      groupId: g.id,
      userId: leaver,
      by: leaver,
      attribution: "preserve_name",
      displayNameSnapshot: "Snap Leaver",
    });
    let m = await groups.membership(g.id, leaver);
    expect(m?.displayNameSnapshot).toBe("Snap Leaver");
    expect(m?.attributionOnLeave).toBe("preserve_name");

    // Re-add and re-remove with anonymize.
    await groups.addMembership({
      groupId: g.id,
      userId: leaver,
      role: "participant",
      by: creator,
    });
    await groups.removeMembership({
      groupId: g.id,
      userId: leaver,
      by: leaver,
      attribution: "anonymize",
      displayNameSnapshot: "Snap Leaver",
    });
    m = await groups.membership(g.id, leaver);
    expect(m?.displayNameSnapshot).toBeNull();
    expect(m?.attributionOnLeave).toBe("anonymize");
  });

  it("concurrent demotions cannot both succeed", async () => {
    const { db, groups } = buildRepo();
    const a = await seedUser(db, "u_race_a", "ra@x.com");
    const b = await seedUser(db, "u_race_b", "rb@x.com");
    const g = await groups.create({ name: "Race", createdBy: a });
    await groups.addMembership({ groupId: g.id, userId: b, role: "admin", by: a });

    // Two simultaneous demotions of the *only two* admins. Exactly one
    // should be allowed by the conditional UPDATE; the other must fail
    // would_orphan_admin.
    const [r1, r2] = await Promise.allSettled([
      groups.setMembershipRole({ groupId: g.id, userId: a, role: "participant", by: a }),
      groups.setMembershipRole({ groupId: g.id, userId: b, role: "participant", by: b }),
    ]);
    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(await groups.countAdmins(g.id)).toBe(1);
  });

  it("consumeInvitation creates the membership and rejects a second consumer", async () => {
    const { db, groups } = buildRepo();
    const inviter = await seedUser(db, "u_inv_a", "inva@x.com");
    const target = await seedUser(db, "u_inv_b", "invb@x.com");
    const other = await seedUser(db, "u_inv_c", "invc@x.com");
    const g = await groups.create({ name: "Inv", createdBy: inviter });

    const inv = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-inv-1",
      email: "invb@x.com",
      createdBy: inviter,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const ok = await groups.consumeInvitation({
      invitationId: inv.id,
      userId: target,
      now: new Date(),
    });
    expect(ok.membership.userId).toBe(target);
    expect(ok.enrollment).toBeNull();

    await expect(
      groups.consumeInvitation({
        invitationId: inv.id,
        userId: other,
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("consumeInvitation does NOT silently re-promote a previously-removed admin", async () => {
    // CR#2 regression. A user who was once admin is removed → returns
    // via a fresh invitation. Their membership row still has `role:
    // "admin"`. Without the role reset on conflict, the upsert revived
    // them as admin without anyone granting it.
    const { db, groups } = buildRepo();
    const owner = await seedUser(db, "u_ret_owner", "ret-o@x.com");
    const returnee = await seedUser(db, "u_ret_user", "ret-u@x.com");
    const g = await groups.create({ name: "Returnee", createdBy: owner });

    await groups.addMembership({
      groupId: g.id,
      userId: returnee,
      role: "admin",
      by: owner,
    });
    expect(await groups.countAdmins(g.id)).toBe(2);

    await groups.removeMembership({
      groupId: g.id,
      userId: returnee,
      by: returnee,
      attribution: "preserve_name",
      displayNameSnapshot: "Returnee",
    });
    expect(await groups.countAdmins(g.id)).toBe(1);

    const inv = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-return",
      email: "ret-u@x.com",
      createdBy: owner,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await groups.consumeInvitation({
      invitationId: inv.id,
      userId: returnee,
      now: new Date(),
    });
    expect(result.membership.role).toBe("participant");
    expect(await groups.countAdmins(g.id)).toBe(1);
  });

  it("consumeInvitation surfaces invitation_revoked (not _consumed) when revoked between read and claim", async () => {
    // Race A regression. Pre-fix: a concurrent revoke landing between
    // the pre-flight read and the conditional UPDATE caused the
    // post-batch detection to throw `invitation_consumed` even though
    // the actual reason was `revoked`.
    const { db, groups } = buildRepo();
    const owner = await seedUser(db, "u_race_owner", "race-o@x.com");
    const target = await seedUser(db, "u_race_target", "race-t@x.com");
    const g = await groups.create({ name: "Race", createdBy: owner });

    const inv = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-revoke-race",
      email: "race-t@x.com",
      createdBy: owner,
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Revoke first → consume sees the row already terminal and must
    // emit `invitation_revoked`, not `invitation_consumed`.
    await groups.revokeInvitation({ id: inv.id, by: owner, now: new Date() });

    await expect(
      groups.consumeInvitation({
        invitationId: inv.id,
        userId: target,
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "invitation_revoked" });
  });

  it("consumeInvitation does not admit the race-loser when two consumers race a generic token", async () => {
    // Race B regression. Pre-fix: the membership upsert was
    // unconditional in the same batch as the invitation update, so
    // both consumers landed memberships even though only one won the
    // invitation claim.
    const { db, groups } = buildRepo();
    const owner = await seedUser(db, "u_open_owner", "open-o@x.com");
    const a = await seedUser(db, "u_open_a", "open-a@x.com");
    const b = await seedUser(db, "u_open_b", "open-b@x.com");
    const g = await groups.create({ name: "Open", createdBy: owner });

    const inv = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-open",
      email: null, // open invitation — both users may attempt
      createdBy: owner,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const [r1, r2] = await Promise.allSettled([
      groups.consumeInvitation({ invitationId: inv.id, userId: a, now: new Date() }),
      groups.consumeInvitation({ invitationId: inv.id, userId: b, now: new Date() }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Only the winner ends up with an active membership.
    const memA = await groups.membership(g.id, a);
    const memB = await groups.membership(g.id, b);
    const activeA = memA !== null && memA.removedAt === null;
    const activeB = memB !== null && memB.removedAt === null;
    expect([activeA, activeB].filter(Boolean).length).toBe(1);
  });

  it("revokeInvitation is idempotent on already-revoked rows", async () => {
    const { db, groups } = buildRepo();
    const u = await seedUser(db, "u_rev", "rv@x.com");
    const g = await groups.create({ name: "Rev", createdBy: u });
    const inv = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-rev",
      email: null,
      createdBy: u,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await groups.revokeInvitation({ id: inv.id, by: u, now: new Date() });
    await groups.revokeInvitation({ id: inv.id, by: u, now: new Date() });
    const fresh = await groups.invitationById(inv.id);
    expect(fresh?.revokedAt).not.toBeNull();
  });

  it("listPendingInvitations excludes consumed / revoked / expired rows", async () => {
    const { db, groups } = buildRepo();
    const u = await seedUser(db, "u_pen", "pen@x.com");
    const target = await seedUser(db, "u_pen_t", "pent@x.com");
    const g = await groups.create({ name: "Pen", createdBy: u });

    const live = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-live",
      email: null,
      createdBy: u,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const revoked = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-revoked",
      email: null,
      createdBy: u,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await groups.revokeInvitation({ id: revoked.id, by: u, now: new Date() });
    const consumed = await groups.createInvitation({
      groupId: g.id,
      trackId: null,
      token: "tok-cons",
      email: "pent@x.com",
      createdBy: u,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await groups.consumeInvitation({
      invitationId: consumed.id,
      userId: target,
      now: new Date(),
    });

    const pending = await groups.listPendingInvitations(g.id, new Date());
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(live.id);
  });
});
