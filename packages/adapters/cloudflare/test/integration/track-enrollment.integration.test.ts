import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { LearningTrackId, UserId } from "@hearth/domain";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createLearningTrackRepository } from "../../src/learning-track-repository.ts";
import { createStudyGroupRepository } from "../../src/study-group-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Behaviour that only real D1 can exercise for the M5 enrollment surface:
 *
 * - `enroll` rejects `enrollment_requires_membership` when the target is
 *   not a current group member of the track's parent group.
 * - `enroll` upserts: a fresh row is inserted; a soft-left row has its
 *   `leftAt` / `leftBy` cleared and `enrolledAt` reset.
 * - `unenroll` runs the orphan check inside one conditional UPDATE — two
 *   facilitators racing each other on an active track cannot both succeed.
 * - `unenroll` allows demote-to-zero on paused / archived tracks (the
 *   carve-out mirrors `wouldOrphanAdmin`'s archived-group behaviour).
 * - `setEnrollmentRole` promotion fails when the target has left.
 * - `setEnrollmentRole` demotion observes the same orphan guard.
 * - `findTracksOrphanedByMemberRemoval` lists active tracks where the user
 *   is the only remaining facilitator — feeds the membership-removal
 *   refusal in the use case layer.
 * - `endAllEnrollmentsForUser` interacts cleanly with active enrollments
 *   and never re-ends already-left rows.
 */
describe("track-enrollment adapter (real D1)", () => {
  function buildRepos() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return {
      db,
      groups: createStudyGroupRepository({ db, gate }),
      tracksRepo: createLearningTrackRepository({ db, gate }),
    };
  }

  type Repos = ReturnType<typeof buildRepos>;
  type Db = Repos["db"];

  async function seedUser(db: Db, id: string, email: string): Promise<UserId> {
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

  async function setupTrack(repos: Repos, suffix: string) {
    const owner = await seedUser(repos.db, `u_${suffix}_owner`, `${suffix}-own@x.com`);
    const group = await repos.groups.create({ name: "G", createdBy: owner });
    const track = await repos.tracksRepo.create({
      groupId: group.id,
      name: "T",
      description: null,
      createdBy: owner,
    });
    return { owner, group, track };
  }

  async function seedMember(
    repos: Repos,
    suffix: string,
    groupId: string,
    role: "participant" | "admin" = "participant",
  ): Promise<UserId> {
    const user = await seedUser(repos.db, `u_${suffix}`, `${suffix}@x.com`);
    await repos.groups.addMembership({
      groupId: groupId as never,
      userId: user,
      role,
      by: user,
    });
    return user;
  }

  describe("enroll", () => {
    it("rejects with enrollment_requires_membership when the target is not a current member", async () => {
      const repos = buildRepos();
      const { owner, track } = await setupTrack(repos, "te_nm");
      const stranger = await seedUser(repos.db, "u_te_nm_s", "te-nm-s@x.com");
      await expect(
        repos.tracksRepo.enroll({ trackId: track.id, userId: stranger, by: owner }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "enrollment_requires_membership" });
    });

    it("inserts a fresh participant row when no enrollment exists", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_ins");
      const member = await seedMember(repos, "te_ins_m", group.id);

      const enrollment = await repos.tracksRepo.enroll({
        trackId: track.id,
        userId: member,
        by: owner,
      });

      expect(enrollment.userId).toBe(member);
      expect(enrollment.role).toBe("participant");
      expect(enrollment.leftAt).toBeNull();
    });

    it("revives a soft-left enrollment by clearing leftAt and resetting enrolledAt", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_rev");
      const member = await seedMember(repos, "te_rev_m", group.id);

      const first = await repos.tracksRepo.enroll({
        trackId: track.id,
        userId: member,
        by: owner,
      });
      await repos.tracksRepo.unenroll({ trackId: track.id, userId: member, by: member });

      const left = await repos.tracksRepo.enrollment(track.id, member);
      expect(left?.leftAt).toBeInstanceOf(Date);

      // Force a clock gap so revived enrolledAt is observably newer.
      await new Promise((r) => setTimeout(r, 5));

      const revived = await repos.tracksRepo.enroll({
        trackId: track.id,
        userId: member,
        by: owner,
      });

      expect(revived.leftAt).toBeNull();
      // UNIQUE forbids two rows; we expect the same logical row revived.
      expect(revived.enrolledAt.getTime()).toBeGreaterThan(first.enrolledAt.getTime());

      const all = await repos.db
        .select()
        .from(schema.trackEnrollments)
        .where(
          and(
            eq(schema.trackEnrollments.trackId, track.id),
            eq(schema.trackEnrollments.userId, member),
          ),
        );
      expect(all.length).toBe(1);
      expect(all[0]?.leftBy).toBeNull();
    });

    it("is an idempotent no-op when an active enrollment already exists", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_idem");
      const member = await seedMember(repos, "te_idem_m", group.id);

      const first = await repos.tracksRepo.enroll({
        trackId: track.id,
        userId: member,
        by: owner,
      });
      const second = await repos.tracksRepo.enroll({
        trackId: track.id,
        userId: member,
        by: owner,
      });
      expect(second.enrolledAt.getTime()).toBe(first.enrolledAt.getTime());
    });

    it("allows enrolling onto a paused track", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_pa");
      const member = await seedMember(repos, "te_pa_m", group.id);
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: owner,
      });
      const enrollment = await repos.tracksRepo.enroll({
        trackId: track.id,
        userId: member,
        by: owner,
      });
      expect(enrollment.leftAt).toBeNull();
    });
  });

  describe("unenroll", () => {
    it("ends an active participant enrollment", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_un");
      const member = await seedMember(repos, "te_un_m", group.id);
      await repos.tracksRepo.enroll({ trackId: track.id, userId: member, by: owner });
      const left = await repos.tracksRepo.unenroll({
        trackId: track.id,
        userId: member,
        by: member,
      });
      expect(left.leftAt).toBeInstanceOf(Date);
    });

    it("rejects would_orphan_facilitator when the actor is the last facilitator on an active track", async () => {
      const repos = buildRepos();
      const { owner, track } = await setupTrack(repos, "te_orphan");
      await expect(
        repos.tracksRepo.unenroll({ trackId: track.id, userId: owner, by: owner }),
      ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_facilitator" });
      // Row unchanged.
      const after = await repos.tracksRepo.enrollment(track.id, owner);
      expect(after?.leftAt).toBeNull();
      expect(after?.role).toBe("facilitator");
    });

    it("allows the last facilitator to leave a paused track (frozen → no live invariant)", async () => {
      const repos = buildRepos();
      const { owner, track } = await setupTrack(repos, "te_orph_paused");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: owner,
      });
      const left = await repos.tracksRepo.unenroll({
        trackId: track.id,
        userId: owner,
        by: owner,
      });
      expect(left.leftAt).toBeInstanceOf(Date);
    });

    it("is idempotent when the row is already left", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_un_idem");
      const member = await seedMember(repos, "te_un_idem_m", group.id);
      await repos.tracksRepo.enroll({ trackId: track.id, userId: member, by: owner });
      const first = await repos.tracksRepo.unenroll({
        trackId: track.id,
        userId: member,
        by: member,
      });
      const second = await repos.tracksRepo.unenroll({
        trackId: track.id,
        userId: member,
        by: member,
      });
      expect(second.leftAt?.getTime()).toBe(first.leftAt?.getTime());
    });
  });

  describe("setEnrollmentRole", () => {
    it("promotes a current participant to facilitator", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_pro");
      const member = await seedMember(repos, "te_pro_m", group.id);
      await repos.tracksRepo.enroll({ trackId: track.id, userId: member, by: owner });
      const updated = await repos.tracksRepo.setEnrollmentRole({
        trackId: track.id,
        userId: member,
        role: "facilitator",
        by: owner,
      });
      expect(updated.role).toBe("facilitator");
    });

    it("rejects promote with not_track_enrollee when target has left", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_pro_left");
      const member = await seedMember(repos, "te_pro_left_m", group.id);
      await repos.tracksRepo.enroll({ trackId: track.id, userId: member, by: owner });
      await repos.tracksRepo.unenroll({ trackId: track.id, userId: member, by: member });
      await expect(
        repos.tracksRepo.setEnrollmentRole({
          trackId: track.id,
          userId: member,
          role: "facilitator",
          by: owner,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_track_enrollee" });
    });

    it("rejects demote of the last facilitator on an active track with would_orphan_facilitator", async () => {
      const repos = buildRepos();
      const { owner, track } = await setupTrack(repos, "te_demo");
      await expect(
        repos.tracksRepo.setEnrollmentRole({
          trackId: track.id,
          userId: owner,
          role: "participant",
          by: owner,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_facilitator" });
      // Role unchanged.
      const after = await repos.tracksRepo.enrollment(track.id, owner);
      expect(after?.role).toBe("facilitator");
    });

    it("allows demote-to-zero on a paused track", async () => {
      const repos = buildRepos();
      const { owner, track } = await setupTrack(repos, "te_demo_paused");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: owner,
      });
      const updated = await repos.tracksRepo.setEnrollmentRole({
        trackId: track.id,
        userId: owner,
        role: "participant",
        by: owner,
      });
      expect(updated.role).toBe("participant");
    });

    it("concurrent demotions of the only two facilitators: exactly one wins", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_race");
      const member = await seedMember(repos, "te_race_m", group.id);
      await repos.tracksRepo.enroll({ trackId: track.id, userId: member, by: owner });
      await repos.tracksRepo.setEnrollmentRole({
        trackId: track.id,
        userId: member,
        role: "facilitator",
        by: owner,
      });

      // Two concurrent demotions — without the conditional UPDATE both
      // would land and orphan the track. The orphan guard in the SQL
      // requires at least one OTHER active facilitator.
      const results = await Promise.allSettled([
        repos.tracksRepo.setEnrollmentRole({
          trackId: track.id,
          userId: owner,
          role: "participant",
          by: owner,
        }),
        repos.tracksRepo.setEnrollmentRole({
          trackId: track.id,
          userId: member,
          role: "participant",
          by: member,
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "CONFLICT",
        reason: "would_orphan_facilitator",
      });

      // Track keeps exactly one facilitator left after the dust settles.
      expect(await repos.tracksRepo.countFacilitators(track.id)).toBe(1);
    });
  });

  describe("listEnrollments", () => {
    it("returns active rows ordered by enrolledAt; includeLeft adds historic rows", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_list");
      const second = await seedMember(repos, "te_list_b", group.id);
      const third = await seedMember(repos, "te_list_c", group.id);

      await repos.tracksRepo.enroll({ trackId: track.id, userId: second, by: owner });
      await new Promise((r) => setTimeout(r, 5));
      await repos.tracksRepo.enroll({ trackId: track.id, userId: third, by: owner });
      await repos.tracksRepo.unenroll({ trackId: track.id, userId: third, by: third });

      const active = await repos.tracksRepo.listEnrollments(track.id, { includeLeft: false });
      expect(active.map((e) => e.userId)).toEqual([owner, second]);

      const all = await repos.tracksRepo.listEnrollments(track.id, { includeLeft: true });
      expect(all.map((e) => e.userId)).toContain(third);
    });
  });

  describe("findTracksOrphanedByMemberRemoval", () => {
    it("returns tracks where the target is the only remaining active facilitator", async () => {
      const repos = buildRepos();
      const { owner, group } = await setupTrack(repos, "te_orph_find").then((s) => ({
        owner: s.owner,
        group: s.group,
      }));
      // Two more tracks under the same group; owner is sole facilitator on both.
      const trackB = await repos.tracksRepo.create({
        groupId: group.id,
        name: "B",
        description: null,
        createdBy: owner,
      });
      const trackC = await repos.tracksRepo.create({
        groupId: group.id,
        name: "C",
        description: null,
        createdBy: owner,
      });
      // Add another facilitator to trackC so it's NOT orphaned by removal.
      const second = await seedMember(repos, "te_orph_find_b", group.id);
      await repos.tracksRepo.enroll({ trackId: trackC.id, userId: second, by: owner });
      await repos.tracksRepo.setEnrollmentRole({
        trackId: trackC.id,
        userId: second,
        role: "facilitator",
        by: owner,
      });

      const orphans = await repos.tracksRepo.findTracksOrphanedByMemberRemoval({
        groupId: group.id,
        userId: owner,
      });
      const names = orphans.map((o) => o.trackName).sort();
      expect(names).toEqual(["B", "T"]);
      expect(orphans.find((o) => o.trackId === trackB.id)).toBeDefined();
      expect(orphans.find((o) => o.trackId === trackC.id)).toBeUndefined();
    });

    it("excludes paused / archived tracks (they have no live invariant)", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_orph_arch");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: owner,
      });
      const orphans = await repos.tracksRepo.findTracksOrphanedByMemberRemoval({
        groupId: group.id,
        userId: owner,
      });
      expect(orphans).toEqual([]);
    });
  });

  describe("endAllEnrollmentsForUser interaction with the M5 surface", () => {
    it("ends the cascade member's enrollments without touching the remaining facilitator", async () => {
      const repos = buildRepos();
      const { owner, group, track } = await setupTrack(repos, "te_cascade");
      const second = await seedMember(repos, "te_cascade_b", group.id);
      await repos.tracksRepo.enroll({ trackId: track.id, userId: second, by: owner });

      const ended = await repos.tracksRepo.endAllEnrollmentsForUser({
        groupId: group.id,
        userId: second,
        by: owner,
      });
      expect(ended).toBe(1);
      // Owner's facilitator row preserved.
      const ownerEnroll = await repos.tracksRepo.enrollment(track.id, owner);
      expect(ownerEnroll?.leftAt).toBeNull();
      const secondEnroll = await repos.tracksRepo.enrollment(track.id, second);
      expect(secondEnroll?.leftAt).toBeInstanceOf(Date);
    });
  });

  describe("enrollmentsForUser", () => {
    it("returns only the user's currently-active enrollments", async () => {
      const repos = buildRepos();
      const { owner, group } = await setupTrack(repos, "te_eful").then((s) => ({
        owner: s.owner,
        group: s.group,
      }));
      const trackB = await repos.tracksRepo.create({
        groupId: group.id,
        name: "B",
        description: null,
        createdBy: owner,
      });
      // Owner is facilitator on both via create's first enrollment.
      const list = await repos.tracksRepo.enrollmentsForUser(owner);
      expect(list.length).toBe(2);
      // Demote one and then mark this enrollment left.
      // Use the cascade to get a clean left state.
      await repos.tracksRepo.endAllEnrollmentsForUser({
        groupId: group.id,
        userId: owner,
        by: owner,
      });
      const after = await repos.tracksRepo.enrollmentsForUser(owner);
      expect(after).toEqual([]);
      void trackB;
    });
  });
});

// Suppress unused-when-narrowing cuid noise.
void ([] as LearningTrackId[]);
