import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import {
  type ContributionPolicyEnvelope,
  DomainError,
  type LearningTrackId,
  type StudyGroupId,
  type TrackStructureEnvelope,
  type UserId,
} from "@hearth/domain";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createLearningTrackRepository } from "../../src/learning-track-repository.ts";
import { createStudyGroupRepository } from "../../src/study-group-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Behaviour that only real D1 can exercise for the M4 Track Lifecycle adapter:
 *   - `create` lands the tracks row + the creator's first facilitator
 *     enrollment in one atomic D1 batch so the "active track keeps ≥ 1
 *     facilitator" invariant holds at row 0.
 *   - `updateStatus` / `updateMetadata` / `saveStructure` /
 *     `saveContributionPolicy` are conditional UPDATEs whose WHERE clauses
 *     race-safely with concurrent flips — the loser observes a typed
 *     CONFLICT, never a half-applied write.
 *   - `loadStructure` / `loadContributionPolicy` re-validate the stored JSON
 *     envelope on read; a corrupt row throws loudly instead of silently
 *     casting.
 *   - `endAllEnrollmentsForUser` is a guarded UPDATE that confines the
 *     cascade to tracks of a single group (no cross-group bleed) and never
 *     re-ends an already-left enrollment.
 */
describe("learning-track adapter (real D1)", () => {
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

  type Db = ReturnType<typeof drizzle<typeof schema>>;
  type Repos = ReturnType<typeof buildRepos>;

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

  /** Per-test scaffolding: a fresh user + group + (optionally) a track. */
  async function setupGroup(repos: Repos, suffix: string) {
    const creator = await seedUser(repos.db, `u_${suffix}`, `${suffix}@x.com`);
    const group = await repos.groups.create({ name: "G", createdBy: creator });
    return { creator, group };
  }

  async function setupTrack(
    repos: Repos,
    suffix: string,
    name = "T",
    description: string | null = null,
  ) {
    const ctx = await setupGroup(repos, suffix);
    const track = await repos.tracksRepo.create({
      groupId: ctx.group.id,
      name,
      description,
      createdBy: ctx.creator,
    });
    return { ...ctx, track };
  }

  describe("create", () => {
    it("inserts the tracks row AND the creator's facilitator enrollment atomically", async () => {
      const repos = buildRepos();
      const { creator, group } = await setupGroup(repos, "tc_create");

      const track = await repos.tracksRepo.create({
        groupId: group.id,
        name: "Intro",
        description: "First track",
        createdBy: creator,
      });

      expect(track.name).toBe("Intro");
      expect(track.description).toBe("First track");
      expect(track.status).toBe("active");
      expect(track.pausedAt).toBeNull();
      expect(track.archivedAt).toBeNull();
      expect(track.archivedBy).toBeNull();

      const trackRows = await repos.db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.id, track.id));
      expect(trackRows.length).toBe(1);

      const enrollmentRows = await repos.db
        .select()
        .from(schema.trackEnrollments)
        .where(
          and(
            eq(schema.trackEnrollments.trackId, track.id),
            eq(schema.trackEnrollments.userId, creator),
          ),
        );
      expect(enrollmentRows.length).toBe(1);
      expect(enrollmentRows[0]?.role).toBe("facilitator");
      expect(enrollmentRows[0]?.leftAt).toBeNull();

      expect(await repos.tracksRepo.countFacilitators(track.id)).toBe(1);
    });

    it("defaults structure to free mode and contribution policy to direct", async () => {
      const repos = buildRepos();
      const { track } = await setupTrack(repos, "tc_def");
      expect(await repos.tracksRepo.loadStructure(track.id)).toEqual({
        v: 1,
        data: { mode: "free" },
      });
      expect(await repos.tracksRepo.loadContributionPolicy(track.id)).toEqual({
        v: 1,
        data: { mode: "direct" },
      });
    });

    it("persists custom structure and contribution policy when provided", async () => {
      const repos = buildRepos();
      const { creator, group } = await setupGroup(repos, "tc_cust");
      const customStructure: TrackStructureEnvelope = {
        v: 1,
        data: {
          mode: "ordered_sections",
          sections: [{ id: "s1", title: "Section 1", activityIds: [] }],
        },
      };
      const customPolicy: ContributionPolicyEnvelope = {
        v: 1,
        data: { mode: "required_review" },
      };
      const track = await repos.tracksRepo.create({
        groupId: group.id,
        name: "Custom",
        description: null,
        createdBy: creator,
        structure: customStructure,
        contributionPolicy: customPolicy,
      });
      expect(await repos.tracksRepo.loadStructure(track.id)).toEqual(customStructure);
      expect(await repos.tracksRepo.loadContributionPolicy(track.id)).toEqual(customPolicy);
    });
  });

  describe("byId / byGroup", () => {
    it("byId returns null for unknown id", async () => {
      const repos = buildRepos();
      expect(await repos.tracksRepo.byId("t_missing" as LearningTrackId)).toBeNull();
    });

    it("byId returns a faithful LearningTrack for a known id", async () => {
      const repos = buildRepos();
      const { group, track } = await setupTrack(repos, "tc_byid", "Faithful", "round-trip");
      const fetched = await repos.tracksRepo.byId(track.id);
      expect(fetched?.id).toBe(track.id);
      expect(fetched?.groupId).toBe(group.id);
      expect(fetched?.name).toBe("Faithful");
      expect(fetched?.description).toBe("round-trip");
      expect(fetched?.status).toBe("active");
    });

    it("byGroup with no opts returns every track in the group ordered by createdAt", async () => {
      const repos = buildRepos();
      const { creator, group } = await setupGroup(repos, "tc_bg");
      const first = await repos.tracksRepo.create({
        groupId: group.id,
        name: "First",
        description: null,
        createdBy: creator,
      });
      // Force second to have a later createdAt deterministically.
      await new Promise((r) => setTimeout(r, 5));
      const second = await repos.tracksRepo.create({
        groupId: group.id,
        name: "Second",
        description: null,
        createdBy: creator,
      });
      const all = await repos.tracksRepo.byGroup(group.id);
      expect(all.map((t) => t.id)).toEqual([first.id, second.id]);
    });

    it("byGroup with status filter returns only matching tracks", async () => {
      const repos = buildRepos();
      const { creator, group } = await setupGroup(repos, "tc_bgs");
      const stayActive = await repos.tracksRepo.create({
        groupId: group.id,
        name: "Active",
        description: null,
        createdBy: creator,
      });
      const willPause = await repos.tracksRepo.create({
        groupId: group.id,
        name: "Paused",
        description: null,
        createdBy: creator,
      });
      await repos.tracksRepo.updateStatus({
        id: willPause.id,
        to: "paused",
        expectedFromStatus: "active",
        by: creator,
      });

      const paused = await repos.tracksRepo.byGroup(group.id, { status: "paused" });
      expect(paused.map((t) => t.id)).toEqual([willPause.id]);
      const active = await repos.tracksRepo.byGroup(group.id, { status: "active" });
      expect(active.map((t) => t.id)).toEqual([stayActive.id]);
    });
  });

  describe("updateStatus", () => {
    it("active → paused sets pausedAt and status", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_pause");
      const paused = await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: creator,
      });
      expect(paused.status).toBe("paused");
      expect(paused.pausedAt).toBeInstanceOf(Date);
      expect(paused.archivedAt).toBeNull();
    });

    it("paused → active clears pausedAt", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_resume");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: creator,
      });
      const reactivated = await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "active",
        expectedFromStatus: "paused",
        by: creator,
      });
      expect(reactivated.status).toBe("active");
      expect(reactivated.pausedAt).toBeNull();
      expect(reactivated.archivedAt).toBeNull();
    });

    it("active → archived sets archivedAt + archivedBy and leaves pausedAt null", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_arch");
      const archived = await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "archived",
        expectedFromStatus: "active",
        by: creator,
      });
      expect(archived.status).toBe("archived");
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(archived.archivedBy).toBe(creator);
      expect(archived.pausedAt).toBeNull();
    });

    it("paused → archived preserves pausedAt so the audit trail keeps the prior pause", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_pa_arch");
      const paused = await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: creator,
      });
      const pausedAtSnapshot = paused.pausedAt?.getTime() ?? -1;

      const archived = await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "archived",
        expectedFromStatus: "paused",
        by: creator,
      });
      expect(archived.status).toBe("archived");
      expect(archived.archivedBy).toBe(creator);
      expect(archived.pausedAt?.getTime()).toBe(pausedAtSnapshot);
    });

    it("throws CONFLICT track_status_changed when expectedFromStatus mismatches", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_mis");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "paused",
        expectedFromStatus: "active",
        by: creator,
      });
      await expect(
        repos.tracksRepo.updateStatus({
          id: track.id,
          to: "archived",
          expectedFromStatus: "active",
          by: creator,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", reason: "track_status_changed" });
    });

    it("throws NOT_FOUND when the track doesn't exist", async () => {
      const repos = buildRepos();
      const creator = await seedUser(repos.db, "u_tc_404", "tc-404@x.com");
      await expect(
        repos.tracksRepo.updateStatus({
          id: "t_missing" as LearningTrackId,
          to: "paused",
          expectedFromStatus: "active",
          by: creator,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "not_found" });
    });
  });

  describe("updateMetadata", () => {
    it("patches name and description and bumps updatedAt", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_meta", "Old", "old desc");
      await new Promise((r) => setTimeout(r, 2));
      const updated = await repos.tracksRepo.updateMetadata(
        track.id,
        { name: "New", description: "new desc" },
        creator,
      );
      expect(updated.name).toBe("New");
      expect(updated.description).toBe("new desc");
      expect(updated.updatedAt.getTime()).toBeGreaterThan(track.updatedAt.getTime());
    });

    it("clears description when explicitly set to null", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_clr", "T", "removeme");
      const updated = await repos.tracksRepo.updateMetadata(
        track.id,
        { description: null },
        creator,
      );
      expect(updated.description).toBeNull();
    });

    it("empty patch still touches updatedAt and preserves name + description", async () => {
      // Documents actual implementation behaviour: `next = { name, description, updatedAt }`
      // is built unconditionally, so an empty patch always bumps updatedAt while
      // leaving content unchanged.
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_empty", "Same", "same desc");
      await new Promise((r) => setTimeout(r, 2));
      const updated = await repos.tracksRepo.updateMetadata(track.id, {}, creator);
      expect(updated.name).toBe("Same");
      expect(updated.description).toBe("same desc");
      expect(updated.updatedAt.getTime()).toBeGreaterThan(track.updatedAt.getTime());
    });

    it("throws CONFLICT track_archived when the track is archived", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_ma");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "archived",
        expectedFromStatus: "active",
        by: creator,
      });
      await expect(
        repos.tracksRepo.updateMetadata(track.id, { name: "x" }, creator),
      ).rejects.toMatchObject({ code: "CONFLICT", reason: "track_archived" });
    });

    it("throws NOT_FOUND when the track doesn't exist", async () => {
      const repos = buildRepos();
      const creator = await seedUser(repos.db, "u_tc_m404", "tc-m404@x.com");
      await expect(
        repos.tracksRepo.updateMetadata("t_missing" as LearningTrackId, { name: "x" }, creator),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe("concurrent-mutation races", () => {
    it("archive vs updateMetadata: one wins, the other CONFLICTs, no half-applied write", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_race1", "Original");

      const results = await Promise.allSettled([
        repos.tracksRepo.updateStatus({
          id: track.id,
          to: "archived",
          expectedFromStatus: "active",
          by: creator,
        }),
        repos.tracksRepo.updateMetadata(track.id, { name: "Renamed" }, creator),
      ]);

      const after = await repos.tracksRepo.byId(track.id);
      expect(after).not.toBeNull();

      if (results[1].status === "fulfilled") {
        // Rename won the race: row should still be active with the new name.
        expect(after?.status).toBe("active");
        expect(after?.name).toBe("Renamed");
      } else {
        // Archive won: rename rejected; row archived with original name.
        expect(after?.status).toBe("archived");
        expect(after?.name).toBe("Original");
        expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
          code: "CONFLICT",
          reason: "track_archived",
        });
      }
    });

    it("pause vs archive: one wins; the loser sees track_status_changed", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_race2");

      const results = await Promise.allSettled([
        repos.tracksRepo.updateStatus({
          id: track.id,
          to: "paused",
          expectedFromStatus: "active",
          by: creator,
        }),
        repos.tracksRepo.updateStatus({
          id: track.id,
          to: "archived",
          expectedFromStatus: "active",
          by: creator,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "CONFLICT",
        reason: "track_status_changed",
      });
    });
  });

  describe("saveStructure / saveContributionPolicy", () => {
    it("saveStructure persists the envelope and round-trips via loadStructure", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_ss");
      const next: TrackStructureEnvelope = {
        v: 1,
        data: {
          mode: "ordered_sections",
          sections: [
            { id: "intro", title: "Intro", activityIds: [] },
            { id: "deep", title: "Deep dive", activityIds: [] },
          ],
        },
      };
      await repos.tracksRepo.saveStructure(track.id, next, creator);
      expect(await repos.tracksRepo.loadStructure(track.id)).toEqual(next);
    });

    it("saveContributionPolicy persists and round-trips via loadContributionPolicy", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_scp");
      const next: ContributionPolicyEnvelope = { v: 1, data: { mode: "optional_review" } };
      await repos.tracksRepo.saveContributionPolicy(track.id, next, creator);
      expect(await repos.tracksRepo.loadContributionPolicy(track.id)).toEqual(next);
    });

    it("loadStructure throws when the persisted JSON is corrupt", async () => {
      const repos = buildRepos();
      const { track } = await setupTrack(repos, "tc_cor");
      // Bypass the repo and write a malformed envelope directly.
      await repos.db
        .update(schema.tracks)
        .set({ trackStructureJson: '{"v":1,"data":{"mode":"???"}}' })
        .where(eq(schema.tracks.id, track.id));
      await expect(repos.tracksRepo.loadStructure(track.id)).rejects.toThrow(/unknown mode/);
    });

    it("saveStructure throws CONFLICT track_archived when the track is archived", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_ssa");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "archived",
        expectedFromStatus: "active",
        by: creator,
      });
      await expect(
        repos.tracksRepo.saveStructure(track.id, { v: 1, data: { mode: "free" } }, creator),
      ).rejects.toMatchObject({ code: "CONFLICT", reason: "track_archived" });
    });

    it("saveContributionPolicy throws CONFLICT track_archived when the track is archived", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "tc_scpa");
      await repos.tracksRepo.updateStatus({
        id: track.id,
        to: "archived",
        expectedFromStatus: "active",
        by: creator,
      });
      await expect(
        repos.tracksRepo.saveContributionPolicy(
          track.id,
          { v: 1, data: { mode: "direct" } },
          creator,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT", reason: "track_archived" });
    });
  });

  describe("endAllEnrollmentsForUser", () => {
    async function enroll(
      db: Db,
      id: string,
      trackId: LearningTrackId,
      userId: UserId,
      opts: { left?: boolean } = {},
    ): Promise<void> {
      const at = opts.left ? new Date(Date.now() - 60_000) : new Date();
      await db.insert(schema.trackEnrollments).values({
        id,
        trackId,
        userId,
        role: "participant",
        enrolledAt: at,
        leftAt: opts.left ? at : null,
        leftBy: opts.left ? userId : null,
      });
    }

    it("ends every active enrollment the user holds in the group's tracks and returns count", async () => {
      const repos = buildRepos();
      const { creator: owner, group } = await setupGroup(repos, "tc_eaef_o");
      const cascader = await seedUser(repos.db, "u_tc_eaef_c", "eaef-c@x.com");
      const trackA = await repos.tracksRepo.create({
        groupId: group.id,
        name: "A",
        description: null,
        createdBy: owner,
      });
      const trackB = await repos.tracksRepo.create({
        groupId: group.id,
        name: "B",
        description: null,
        createdBy: owner,
      });
      await enroll(repos.db, "te_eaef_a", trackA.id, cascader);
      await enroll(repos.db, "te_eaef_b", trackB.id, cascader);

      const ended = await repos.tracksRepo.endAllEnrollmentsForUser({
        groupId: group.id,
        userId: cascader,
        by: owner,
      });
      expect(ended).toBe(2);
      expect((await repos.tracksRepo.enrollment(trackA.id, cascader))?.leftAt).toBeInstanceOf(Date);
      expect((await repos.tracksRepo.enrollment(trackB.id, cascader))?.leftAt).toBeInstanceOf(Date);
    });

    it("does NOT end enrollments on tracks in OTHER groups (cross-group isolation)", async () => {
      const repos = buildRepos();
      const { creator: owner, group: groupA } = await setupGroup(repos, "tc_iso_a");
      const groupB = await repos.groups.create({ name: "B", createdBy: owner });
      const cascader = await seedUser(repos.db, "u_tc_iso_c", "iso-c@x.com");
      const trackInA = await repos.tracksRepo.create({
        groupId: groupA.id,
        name: "TA",
        description: null,
        createdBy: owner,
      });
      const trackInB = await repos.tracksRepo.create({
        groupId: groupB.id,
        name: "TB",
        description: null,
        createdBy: owner,
      });
      await enroll(repos.db, "te_iso_a", trackInA.id, cascader);
      await enroll(repos.db, "te_iso_b", trackInB.id, cascader);

      const ended = await repos.tracksRepo.endAllEnrollmentsForUser({
        groupId: groupA.id,
        userId: cascader,
        by: owner,
      });
      expect(ended).toBe(1);
      expect((await repos.tracksRepo.enrollment(trackInA.id, cascader))?.leftAt).toBeInstanceOf(
        Date,
      );
      expect((await repos.tracksRepo.enrollment(trackInB.id, cascader))?.leftAt).toBeNull();
    });

    it("does not re-end enrollments that are already left", async () => {
      const repos = buildRepos();
      const { creator: owner, track } = await setupTrack(repos, "tc_rer");
      const cascader = await seedUser(repos.db, "u_tc_rer_c", "rer-c@x.com");
      await enroll(repos.db, "te_rer", track.id, cascader, { left: true });
      const before = await repos.tracksRepo.enrollment(track.id, cascader);

      const ended = await repos.tracksRepo.endAllEnrollmentsForUser({
        groupId: (await repos.tracksRepo.byId(track.id))?.groupId as StudyGroupId,
        userId: cascader,
        by: owner,
      });
      expect(ended).toBe(0);
      const after = await repos.tracksRepo.enrollment(track.id, cascader);
      expect(after?.leftAt?.getTime()).toBe(before?.leftAt?.getTime());
    });

    it("returns 0 when the user has no enrollments in the group", async () => {
      const repos = buildRepos();
      const { creator: owner, group } = await setupGroup(repos, "tc_zero");
      const stranger = await seedUser(repos.db, "u_tc_zero_s", "zero-s@x.com");
      await repos.tracksRepo.create({
        groupId: group.id,
        name: "T",
        description: null,
        createdBy: owner,
      });
      const ended = await repos.tracksRepo.endAllEnrollmentsForUser({
        groupId: group.id,
        userId: stranger,
        by: owner,
      });
      expect(ended).toBe(0);
    });
  });

  describe("countFacilitators / countEnrollments / listFacilitators / enrollment", () => {
    it("countFacilitators reflects only active facilitator rows on this track", async () => {
      const repos = buildRepos();
      const { creator: owner, group } = await setupGroup(repos, "tc_cf");
      const second = await seedUser(repos.db, "u_tc_cf_s", "cf-s@x.com");
      const trackA = await repos.tracksRepo.create({
        groupId: group.id,
        name: "A",
        description: null,
        createdBy: owner,
      });
      const trackB = await repos.tracksRepo.create({
        groupId: group.id,
        name: "B",
        description: null,
        createdBy: owner,
      });

      const now = new Date();
      await repos.db.insert(schema.trackEnrollments).values({
        id: "te_cf_active",
        trackId: trackA.id,
        userId: second,
        role: "facilitator",
        enrolledAt: now,
        leftAt: null,
        leftBy: null,
      });
      expect(await repos.tracksRepo.countFacilitators(trackA.id)).toBe(2);
      expect(await repos.tracksRepo.countFacilitators(trackB.id)).toBe(1);

      // Mark second as left → drops back to 1 on trackA.
      await repos.db
        .update(schema.trackEnrollments)
        .set({ leftAt: now, leftBy: owner })
        .where(eq(schema.trackEnrollments.id, "te_cf_active"));
      expect(await repos.tracksRepo.countFacilitators(trackA.id)).toBe(1);
    });

    it("countEnrollments reflects only active rows (any role) on this track", async () => {
      const repos = buildRepos();
      const { creator: owner, track } = await setupTrack(repos, "tc_ce");
      const part1 = await seedUser(repos.db, "u_tc_ce_a", "ce-a@x.com");
      const part2 = await seedUser(repos.db, "u_tc_ce_b", "ce-b@x.com");
      const now = new Date();
      await repos.db.insert(schema.trackEnrollments).values([
        {
          id: "te_ce_a",
          trackId: track.id,
          userId: part1,
          role: "participant",
          enrolledAt: now,
          leftAt: null,
          leftBy: null,
        },
        {
          id: "te_ce_b",
          trackId: track.id,
          userId: part2,
          role: "participant",
          enrolledAt: now,
          leftAt: now,
          leftBy: owner,
        },
      ]);
      // 1 facilitator (creator) + 1 active participant = 2; the left one must not count.
      expect(await repos.tracksRepo.countEnrollments(track.id)).toBe(2);
    });

    it("listFacilitators returns active facilitator rows ordered by enrolledAt", async () => {
      const repos = buildRepos();
      const { creator: owner, track } = await setupTrack(repos, "tc_lf");
      const second = await seedUser(repos.db, "u_tc_lf_s", "lf-s@x.com");
      const later = new Date(Date.now() + 5_000);
      await repos.db.insert(schema.trackEnrollments).values({
        id: "te_lf",
        trackId: track.id,
        userId: second,
        role: "facilitator",
        enrolledAt: later,
        leftAt: null,
        leftBy: null,
      });
      const facils = await repos.tracksRepo.listFacilitators(track.id);
      expect(facils.map((f) => f.userId)).toEqual([owner, second]);
    });

    it("enrollment returns null when there is no row for the (track, user)", async () => {
      const repos = buildRepos();
      const { track } = await setupTrack(repos, "tc_en");
      const stranger = await seedUser(repos.db, "u_tc_en_s", "en-s@x.com");
      expect(await repos.tracksRepo.enrollment(track.id, stranger)).toBeNull();
    });
  });
});
