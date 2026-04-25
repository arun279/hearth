import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import { DomainError, type StudyGroupId, type UserId } from "@hearth/domain";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createStudyGroupRepository } from "../../src/study-group-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Behaviour that only real D1 can exercise:
 *   - `create` inserts the group AND the creator's first admin membership
 *     in a single committed batch (the orphan-admin invariant lands at
 *     creation time, with no observable in-between state);
 *   - `updateStatus` transitions are idempotent and preserve unrelated
 *     columns; `archivedAt` / `archivedBy` are populated on archive and
 *     cleared on unarchive;
 *   - `updateMetadata` rejects an archived group with the typed
 *     `group_archived` reason and otherwise touches `updatedAt`;
 *   - `listForUser` returns only groups the user holds an active
 *     membership in (filters out removed memberships);
 *   - `countAdmins` and `counts` reflect the current state precisely.
 */
describe("study-group adapter (real D1)", () => {
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
  ): Promise<UserId> {
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
    return id as UserId;
  }

  describe("create", () => {
    it("inserts the group AND the creator's admin membership atomically", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_creator", "c@x.com");

      const group = await groups.create({
        name: "Tuesday Night Learners",
        description: "Small group, patient pace.",
        createdBy: creator,
      });

      expect(group.name).toBe("Tuesday Night Learners");
      expect(group.description).toBe("Small group, patient pace.");
      expect(group.status).toBe("active");
      expect(group.admissionPolicy).toBe("invite_only");
      expect(group.archivedAt).toBeNull();
      expect(group.archivedBy).toBeNull();

      // Read back the membership row directly — confirms both rows landed.
      const memberships = await db
        .select()
        .from(schema.groupMemberships)
        .where(
          and(
            eq(schema.groupMemberships.groupId, group.id),
            eq(schema.groupMemberships.userId, creator),
          ),
        );
      expect(memberships.length).toBe(1);
      expect(memberships[0]?.role).toBe("admin");
      expect(memberships[0]?.removedAt).toBeNull();
    });

    it("admin count is exactly 1 immediately after create", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_solo", "solo@x.com");
      const group = await groups.create({ name: "G", createdBy: creator });
      expect(await groups.countAdmins(group.id)).toBe(1);
    });

    it("description defaults to null when omitted", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_nodesc", "nd@x.com");
      const group = await groups.create({ name: "Bare", createdBy: creator });
      expect(group.description).toBeNull();
    });
  });

  describe("byId / list / listForUser / membershipsForUser", () => {
    it("byId returns null for unknown ids", async () => {
      const { groups } = buildRepo();
      expect(await groups.byId("g_missing" as StudyGroupId)).toBeNull();
    });

    it("listForUser excludes groups the user has been removed from", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_lf", "lf@x.com");
      const stayer = await seedUser(db, "u_stay", "s@x.com");
      const leaver = await seedUser(db, "u_leave", "lv@x.com");

      const a = await groups.create({ name: "A", createdBy: creator });
      const b = await groups.create({ name: "B", createdBy: creator });

      // Insert two extra memberships by hand (M3 will provide a port method).
      const now = new Date();
      await db.insert(schema.groupMemberships).values([
        {
          id: "m_stay",
          groupId: a.id,
          userId: stayer,
          role: "participant",
          joinedAt: now,
          removedAt: null,
        },
        {
          id: "m_leave",
          groupId: b.id,
          userId: leaver,
          role: "participant",
          joinedAt: now,
          // Removed: should NOT show up in listForUser.
          removedAt: now,
          removedBy: creator,
        },
      ]);

      const stayerGroups = await groups.listForUser(stayer);
      expect(stayerGroups.map((g) => g.name).sort()).toEqual(["A"]);

      const leaverGroups = await groups.listForUser(leaver);
      expect(leaverGroups).toHaveLength(0);

      const stayerMems = await groups.membershipsForUser(stayer);
      expect(stayerMems).toHaveLength(1);
      expect(stayerMems[0]?.role).toBe("participant");
    });

    it("list filters by status when requested", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_listf", "lf@x.com");
      const a = await groups.create({ name: "A", createdBy: creator });
      const b = await groups.create({ name: "B", createdBy: creator });
      await groups.updateStatus(a.id, "archived", creator);

      const active = await groups.list({ status: "active" });
      const archived = await groups.list({ status: "archived" });
      expect(active.map((g) => g.id)).toEqual([b.id]);
      expect(archived.map((g) => g.id)).toEqual([a.id]);
    });
  });

  describe("updateStatus", () => {
    it("archive populates archivedAt + archivedBy; unarchive clears them", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_status", "st@x.com");
      const group = await groups.create({ name: "G", createdBy: creator });

      await groups.updateStatus(group.id, "archived", creator);
      const archived = await groups.byId(group.id);
      expect(archived?.status).toBe("archived");
      expect(archived?.archivedAt).toBeInstanceOf(Date);
      expect(archived?.archivedBy).toBe(creator);

      await groups.updateStatus(group.id, "active", creator);
      const reactivated = await groups.byId(group.id);
      expect(reactivated?.status).toBe("active");
      expect(reactivated?.archivedAt).toBeNull();
      expect(reactivated?.archivedBy).toBeNull();
      // Other columns survive the round-trip.
      expect(reactivated?.name).toBe("G");
      expect(reactivated?.createdAt.getTime()).toBe(group.createdAt.getTime());
    });

    it("is idempotent on a no-op flip", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_idem", "i@x.com");
      const group = await groups.create({ name: "G", createdBy: creator });

      await groups.updateStatus(group.id, "active", creator);
      const after = await groups.byId(group.id);
      expect(after?.status).toBe("active");
      expect(after?.archivedAt).toBeNull();
    });

    it("two concurrent archive flips both resolve; the row ends archived exactly once", async () => {
      // The header docstring claims `updateStatus` is safe under concurrent
      // flips because the WHERE clause filters on the prior state. This
      // exercises the claim: launch two simultaneous archive calls and
      // assert (a) both promises resolve without throwing, (b) the final
      // row is archived, (c) `archivedBy` is populated (i.e., one of the
      // two flips actually wrote). D1's single-threaded execution serialises
      // the two statements; the second sees status='archived' and matches
      // zero rows — the silent no-op the comment promises.
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_concur", "c@x.com");
      const group = await groups.create({ name: "G", createdBy: creator });

      const results = await Promise.allSettled([
        groups.updateStatus(group.id, "archived", creator),
        groups.updateStatus(group.id, "archived", creator),
      ]);
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("fulfilled");

      const after = await groups.byId(group.id);
      expect(after?.status).toBe("archived");
      expect(after?.archivedBy).toBe(creator);
    });

    it("concurrent updateMetadata + archive — metadata never lands on archived row", async () => {
      // Exercises the TOCTOU fix in `updateMetadata`: even if the rename's
      // SELECT sees status='active', the conditional UPDATE WHERE
      // status='active' rejects the write if archive committed in between.
      // Either rename wins (final row is active with the new name) or
      // archive wins (rename rejects with CONFLICT/group_archived and the
      // name is unchanged). Critically, the row never ends archived with a
      // changed name — that would violate the "archived = frozen" contract.
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_race", "r@x.com");
      const group = await groups.create({
        name: "Original",
        createdBy: creator,
      });

      const results = await Promise.allSettled([
        groups.updateStatus(group.id, "archived", creator),
        groups.updateMetadata(group.id, { name: "Maybe-changed" }, creator),
      ]);

      const after = await groups.byId(group.id);

      if (results[1].status === "fulfilled") {
        // Rename won the race: row should still be active with new name.
        expect(after?.status).toBe("active");
        expect(after?.name).toBe("Maybe-changed");
      } else {
        // Archive won: rename rejected; row archived with original name.
        expect(after?.status).toBe("archived");
        expect(after?.name).toBe("Original");
        expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
          code: "CONFLICT",
          reason: "group_archived",
        });
      }
    });
  });

  describe("updateMetadata", () => {
    it("patches name + description and bumps updatedAt", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_meta", "m@x.com");
      const group = await groups.create({
        name: "Old",
        description: "old desc",
        createdBy: creator,
      });
      // Sleep one ms so updatedAt can move.
      await new Promise((r) => setTimeout(r, 2));
      const updated = await groups.updateMetadata(
        group.id,
        { name: "New", description: "new desc" },
        creator,
      );
      expect(updated.name).toBe("New");
      expect(updated.description).toBe("new desc");
      expect(updated.updatedAt.getTime()).toBeGreaterThan(group.updatedAt.getTime());
    });

    it("clears description when explicitly set to null", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_metanull", "mn@x.com");
      const group = await groups.create({
        name: "G",
        description: "removeme",
        createdBy: creator,
      });
      const updated = await groups.updateMetadata(group.id, { description: null }, creator);
      expect(updated.description).toBeNull();
    });

    it("rejects an archived group with code group_archived", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_arch", "a@x.com");
      const group = await groups.create({ name: "G", createdBy: creator });
      await groups.updateStatus(group.id, "archived", creator);

      await expect(groups.updateMetadata(group.id, { name: "x" }, creator)).rejects.toMatchObject({
        code: "CONFLICT",
        reason: "group_archived",
      });
    });

    it("404s on an unknown group", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_404", "f@x.com");
      await expect(
        groups.updateMetadata("g_does_not_exist" as StudyGroupId, { name: "x" }, creator),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe("counts", () => {
    it("reports memberCount=1 immediately after create; tracks/library are zero until those land", async () => {
      const { db, groups } = buildRepo();
      const creator = await seedUser(db, "u_counts", "c@x.com");
      const group = await groups.create({ name: "G", createdBy: creator });
      const counts = await groups.counts(group.id);
      expect(counts.memberCount).toBe(1);
      expect(counts.trackCount).toBe(0);
      expect(counts.libraryItemCount).toBe(0);
    });
  });
});
