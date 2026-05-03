import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { LearningActivityDraft, StudyGroupId, UserId } from "@hearth/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createLearningActivityRepository } from "../../src/learning-activity-repository.ts";
import { createLearningTrackRepository } from "../../src/learning-track-repository.ts";
import { createLibraryItemRepository } from "../../src/library-item-repository.ts";
import { createStudyGroupRepository } from "../../src/study-group-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Real-D1 integration coverage for the M8 Learning Activity adapter.
 * Exercises the behavior that only deployed-shape SQLite can show:
 *
 *   - `create` writes the activity row + library refs + prereq edges
 *     + suggested-sequence edges in one atomic batch.
 *   - `byId` re-parses every envelope on read; round-trips a
 *     fully-populated activity without drift.
 *   - `update` preserves Part ids on a no-op edit so M11's
 *     `part_progress.partId` references stay valid.
 *   - `setLibraryRefs` is wholesale-replace; deleting a referenced
 *     `library_items` row is FK-blocked at the DB layer.
 *   - `setPrerequisites` re-runs the cross-activity acyclic invariant
 *     inside the transaction; the post-write graph cannot land a cycle.
 */
describe("learning-activity adapter (real D1)", () => {
  function buildRepos() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return {
      db,
      groups: createStudyGroupRepository({ db, gate }),
      tracksRepo: createLearningTrackRepository({ db, gate }),
      library: createLibraryItemRepository({ db, gate }),
      activities: createLearningActivityRepository({ db, gate }),
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

  async function setupTrack(repos: Repos, suffix: string) {
    const creator = await seedUser(repos.db, `u_${suffix}`, `${suffix}@x.com`);
    const group = await repos.groups.create({ name: "G", createdBy: creator });
    const track = await repos.tracksRepo.create({
      groupId: group.id,
      name: "Track",
      description: null,
      createdBy: creator,
    });
    return { creator, group, track };
  }

  async function seedPdfItem(repos: Repos, groupId: StudyGroupId, uploader: UserId) {
    const itemId = `li_${Math.random().toString(36).slice(2, 10)}`;
    const revisionId = `rev_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date();
    return repos.library.create({
      id: itemId as never,
      groupId,
      title: "Primer",
      description: null,
      tags: [],
      uploadedBy: uploader,
      firstRevision: {
        id: revisionId as never,
        storageKey: `library/${groupId}/${itemId}/${revisionId}`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        originalFilename: "primer.pdf",
        uploadedBy: uploader,
        uploadedAt: now,
      },
      now,
    });
  }

  function baseDraft(trackId: LearningActivityDraft["trackId"]): LearningActivityDraft {
    return {
      trackId,
      title: "Activity",
      description: null,
      parts: [
        { kind: "write_reflection", id: "p1", prompt: "Reflect." },
        { kind: "write_reflection", id: "p2", prompt: "Again." },
      ],
      flow: { prereqs: [{ fromPartId: "p1", toPartId: "p2", kind: "hard" }] },
      audience: { kind: "everyone_enrolled" },
      window: null,
      postClosePolicy: null,
      completionRule: { kind: "manual_mark" },
      libraryRefs: [],
      prerequisiteActivityIds: [],
      suggestedNextActivityIds: [],
    };
  }

  describe("create + byId", () => {
    it("round-trips a fully-populated activity through D1", async () => {
      const repos = buildRepos();
      const { creator, group, track } = await setupTrack(repos, "ac_create");
      const item = await seedPdfItem(repos, group.id, creator);

      const draft: LearningActivityDraft = {
        ...baseDraft(track.id),
        parts: [
          { kind: "read_library_item", id: "p_read", libraryItemId: item.item.id, title: "Read" },
          { kind: "write_reflection", id: "p_reflect", prompt: "Reflect." },
        ],
        flow: { prereqs: [{ fromPartId: "p_read", toPartId: "p_reflect", kind: "hard" }] },
        window: {
          opensAt: 1_745_452_800_000,
          dueAt: 1_745_625_600_000,
          closesAt: 1_745_798_400_000,
        },
        postClosePolicy: { kind: "visible_locked" },
        completionRule: { kind: "all_parts_complete" },
        libraryRefs: [{ libraryItemId: item.item.id, pinnedRevisionId: null }],
      };
      const created = await repos.activities.create({ draft, createdBy: creator });

      const round = await repos.activities.byId(created.id);
      expect(round).not.toBeNull();
      expect(round?.title).toBe("Activity");
      expect(round?.parts).toHaveLength(2);
      expect(round?.window?.dueAt).toBe(1_745_625_600_000);
      expect(round?.postClosePolicy?.kind).toBe("visible_locked");
      expect(round?.completionRule.kind).toBe("all_parts_complete");
      expect(round?.libraryRefs).toHaveLength(1);
      expect(round?.libraryRefs[0]?.libraryItemId).toBe(item.item.id);
    });
  });

  describe("FK RESTRICT on activity_library_refs", () => {
    it("blocks hard-deleting a referenced library item", async () => {
      const repos = buildRepos();
      const { creator, group, track } = await setupTrack(repos, "ac_fk");
      const item = await seedPdfItem(repos, group.id, creator);

      const draft: LearningActivityDraft = {
        ...baseDraft(track.id),
        libraryRefs: [{ libraryItemId: item.item.id, pinnedRevisionId: null }],
      };
      await repos.activities.create({ draft, createdBy: creator });

      // The FK on activity_library_refs.libraryItemId is RESTRICT — D1
      // rejects the delete when any ref points at the row. We hit the
      // raw drizzle delete to bypass any application-side soft-stop.
      await expect(
        repos.db.delete(schema.libraryItems).where(eq(schema.libraryItems.id, item.item.id)),
      ).rejects.toThrow();
    });
  });

  describe("update preserves Part ids on a no-op edit", () => {
    it("a no-op patch keeps every Part id unchanged", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "ac_id");

      const created = await repos.activities.create({
        draft: baseDraft(track.id),
        createdBy: creator,
      });
      const before = created.parts.map((p) => p.id);
      const updated = await repos.activities.update({
        id: created.id,
        patch: { title: "Activity (renamed)" },
        by: creator,
      });
      const after = updated.parts.map((p) => p.id);
      expect(after).toEqual(before);
    });
  });

  describe("setPrerequisites cycle re-check", () => {
    it("rejects a wholesale replace that would close a cross-activity cycle", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "ac_cycle");
      const a = await repos.activities.create({
        draft: { ...baseDraft(track.id), title: "A" },
        createdBy: creator,
      });
      const b = await repos.activities.create({
        draft: { ...baseDraft(track.id), title: "B" },
        createdBy: creator,
      });
      // a → b
      await repos.activities.setPrerequisites({
        activityId: a.id,
        prerequisiteActivityIds: [b.id],
      });
      // proposing b → a would close (a → b → a) — must reject.
      await expect(
        repos.activities.setPrerequisites({
          activityId: b.id,
          prerequisiteActivityIds: [a.id],
        }),
      ).rejects.toThrow(/cycle/);
    });
  });

  describe("delete refused while prereq edges exist", () => {
    it("delete fails by FK when an activity is held as a prerequisite by another", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "ac_del");
      const a = await repos.activities.create({
        draft: { ...baseDraft(track.id), title: "A" },
        createdBy: creator,
      });
      const b = await repos.activities.create({
        draft: { ...baseDraft(track.id), title: "B" },
        createdBy: creator,
      });
      // b depends on a
      await repos.activities.setPrerequisites({
        activityId: b.id,
        prerequisiteActivityIds: [a.id],
      });
      // The use case refuses with `activity_has_dependents`; the
      // adapter-level delete also fails — the activity's outgoing
      // children are wiped first, but b's prereq row still references
      // a, so the final DELETE on learning_activities is FK-blocked.
      await expect(repos.activities.delete({ id: a.id, by: creator })).rejects.toThrow();
    });
  });

  describe("setLibraryRefs is wholesale replace", () => {
    it("replacing refs deletes the prior set", async () => {
      const repos = buildRepos();
      const { creator, group, track } = await setupTrack(repos, "ac_refs");
      const item1 = await seedPdfItem(repos, group.id, creator);
      const item2 = await seedPdfItem(repos, group.id, creator);

      const created = await repos.activities.create({
        draft: {
          ...baseDraft(track.id),
          libraryRefs: [{ libraryItemId: item1.item.id, pinnedRevisionId: null }],
        },
        createdBy: creator,
      });
      await repos.activities.setLibraryRefs({
        activityId: created.id,
        refs: [{ libraryItemId: item2.item.id, pinnedRevisionId: null }],
      });
      const refs = await repos.activities.listLibraryRefs(created.id);
      expect(refs.map((r) => r.libraryItemId)).toEqual([item2.item.id]);
    });
  });

  describe("concurrent track-archive vs activity-update race", () => {
    it("the loser sees CONFLICT track_archived; the row never lands in a corrupted state", async () => {
      const repos = buildRepos();
      const { creator, track } = await setupTrack(repos, "ac_race");
      const created = await repos.activities.create({
        draft: baseDraft(track.id),
        createdBy: creator,
      });

      // Race the metadata update against the parent track's archive
      // transition. The adapter's update gates on
      // `tracks.status != 'archived'` inside the WHERE clause, so one
      // of the two requests must observe the post-archive state and
      // refuse with CONFLICT — the other lands cleanly. Either order is
      // valid; we just need the invariant to hold and the row to never
      // end up in a half-applied state.
      const results = await Promise.allSettled([
        repos.activities.update({
          id: created.id,
          patch: { title: "Renamed during race" },
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
      // Both could resolve if the update raced through before the
      // archive landed — that's a valid outcome. The invariant we
      // really care about: if the update fails, it MUST fail with the
      // typed CONFLICT track_archived deny code, never an opaque error.
      if (rejected.length > 0) {
        for (const r of rejected) {
          if (r.status !== "rejected") continue;
          const err = r.reason as { code?: string; reason?: string };
          expect(err.code).toBe("CONFLICT");
          expect(err.reason).toBe("track_archived");
        }
      }
      // At least one must succeed — both rejecting would mean the system
      // got stuck and the row is unreachable from either side.
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Final state: title was either updated OR not, and the parent
      // track is archived. Either combination is internally consistent;
      // the assertion is "no torn write" — which means re-reading the
      // activity round-trips cleanly through the envelope parsers.
      const after = await repos.activities.byId(created.id);
      expect(after).not.toBeNull();
      expect(["Activity", "Renamed during race"]).toContain(after?.title);
    });
  });
});
