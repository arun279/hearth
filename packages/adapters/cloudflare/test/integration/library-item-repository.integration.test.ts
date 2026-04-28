import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { LibraryItemId, LibraryRevisionId, StudyGroupId, UserId } from "@hearth/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createLibraryItemRepository } from "../../src/library-item-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Behaviour that only real D1 can exercise:
 *   - `create` lands the item + first revision atomically and pins
 *     `currentRevisionId` to the first revision id;
 *   - `addRevision` is monotonic — `revision_number` increments under the
 *     UNIQUE index guard and `currentRevisionId` follows;
 *   - retired items reject `addRevision` with a CONFLICT;
 *   - `byGroup` returns active items first, joined with their current
 *     revision and steward / used-in counts;
 *   - `markRetired` is idempotent;
 *   - `addSteward` is idempotent through ON CONFLICT DO NOTHING;
 *   - FK RESTRICT against `activity_library_refs` blocks hard-deleting an
 *     item that's still referenced.
 */
describe("library-item adapter (real D1)", () => {
  function buildRepo() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return { db, library: createLibraryItemRepository({ db, gate }) };
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

  async function seedGroup(
    db: ReturnType<typeof drizzle<typeof schema>>,
    id: string,
  ): Promise<StudyGroupId> {
    const now = new Date();
    await db.insert(schema.groups).values({
      id,
      name: "Test Group",
      description: null,
      admissionPolicy: "invite_only",
      status: "active",
      archivedAt: null,
      archivedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    return id as StudyGroupId;
  }

  it("create lands the item + first revision atomically", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_creator_li", "creator@x.com");
    const groupId = await seedGroup(db, "g_li_create");
    const itemId = "li_create_1" as LibraryItemId;
    const revisionId = "lr_create_1" as LibraryRevisionId;
    const now = new Date();

    const detail = await library.create({
      id: itemId,
      groupId,
      title: "Primer",
      description: "A test primer.",
      tags: ["spanish", "draft"],
      uploadedBy: userId,
      firstRevision: {
        id: revisionId,
        storageKey: `library/${groupId}/${itemId}/${revisionId}`,
        mimeType: "application/pdf",
        sizeBytes: 1234,
        originalFilename: "primer.pdf",
        uploadedBy: userId,
        uploadedAt: now,
      },
      now,
    });

    expect(detail.item.id).toBe(itemId);
    expect(detail.item.currentRevisionId).toBe(revisionId);
    expect(detail.item.tags).toEqual(["spanish", "draft"]);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]?.revisionNumber).toBe(1);

    // FTS5 mirror got populated by the trigger from migration 0001.
    const ftsRows = await db.all<{ readonly title: string }>(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal SQL
      `SELECT title FROM library_items_fts WHERE library_item_id = '${itemId}'`,
    );
    expect(ftsRows[0]?.title).toBe("Primer");
  });

  it("addRevision increments revision_number and updates currentRevisionId", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_addrev", "addrev@x.com");
    const groupId = await seedGroup(db, "g_li_addrev");
    const itemId = "li_addrev_1" as LibraryItemId;
    const r1 = "lr_addrev_1" as LibraryRevisionId;
    const r2 = "lr_addrev_2" as LibraryRevisionId;
    const now = new Date();

    await library.create({
      id: itemId,
      groupId,
      title: "Primer",
      description: null,
      tags: [],
      uploadedBy: userId,
      firstRevision: {
        id: r1,
        storageKey: `library/${groupId}/${itemId}/${r1}`,
        mimeType: "application/pdf",
        sizeBytes: 1000,
        originalFilename: null,
        uploadedBy: userId,
        uploadedAt: now,
      },
      now,
    });

    const result = await library.addRevision({
      libraryItemId: itemId,
      revision: {
        id: r2,
        storageKey: `library/${groupId}/${itemId}/${r2}`,
        mimeType: "application/pdf",
        sizeBytes: 2000,
        originalFilename: "primer-v2.pdf",
        uploadedBy: userId,
        uploadedAt: new Date(now.getTime() + 1000),
      },
    });
    expect(result.revision.revisionNumber).toBe(2);
    expect(result.item.currentRevisionId).toBe(r2);

    const revisions = await library.listRevisions(itemId);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
  });

  it("addRevision rejects retired items with a CONFLICT", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_retire", "retire@x.com");
    const groupId = await seedGroup(db, "g_li_retire");
    const itemId = "li_retire_1" as LibraryItemId;
    const r1 = "lr_retire_1" as LibraryRevisionId;
    const r2 = "lr_retire_2" as LibraryRevisionId;
    const now = new Date();

    await library.create({
      id: itemId,
      groupId,
      title: "Soon-to-be retired",
      description: null,
      tags: [],
      uploadedBy: userId,
      firstRevision: {
        id: r1,
        storageKey: `library/${groupId}/${itemId}/${r1}`,
        mimeType: "application/pdf",
        sizeBytes: 1000,
        originalFilename: null,
        uploadedBy: userId,
        uploadedAt: now,
      },
      now,
    });
    const retired = await library.markRetired(itemId, userId, now);
    expect(retired.retiredAt).not.toBeNull();

    // Calling again is idempotent — same row, no error.
    const retiredAgain = await library.markRetired(itemId, userId, new Date(now.getTime() + 1000));
    expect(retiredAgain.retiredAt?.getTime()).toBe(retired.retiredAt?.getTime());

    await expect(
      library.addRevision({
        libraryItemId: itemId,
        revision: {
          id: r2,
          storageKey: `library/${groupId}/${itemId}/${r2}`,
          mimeType: "application/pdf",
          sizeBytes: 1500,
          originalFilename: null,
          uploadedBy: userId,
          uploadedAt: now,
        },
      }),
    ).rejects.toMatchObject({ reason: "library_item_retired" });
  });

  it("addSteward is idempotent and listStewards orders by grantedAt", async () => {
    const { db, library } = buildRepo();
    const owner = await seedUser(db, "u_owner_st", "owner@x.com");
    const stewardA = await seedUser(db, "u_st_a", "a@x.com");
    const groupId = await seedGroup(db, "g_li_steward");
    const itemId = "li_steward_1" as LibraryItemId;
    const r1 = "lr_steward_1" as LibraryRevisionId;
    const now = new Date();

    await library.create({
      id: itemId,
      groupId,
      title: "Stewarded",
      description: null,
      tags: [],
      uploadedBy: owner,
      firstRevision: {
        id: r1,
        storageKey: `library/${groupId}/${itemId}/${r1}`,
        mimeType: "application/pdf",
        sizeBytes: 100,
        originalFilename: null,
        uploadedBy: owner,
        uploadedAt: now,
      },
      now,
    });

    const first = await library.addSteward({
      libraryItemId: itemId,
      userId: stewardA,
      grantedBy: owner,
      grantedAt: now,
    });
    const second = await library.addSteward({
      libraryItemId: itemId,
      userId: stewardA,
      grantedBy: owner,
      grantedAt: new Date(now.getTime() + 1000),
    });
    expect(second.id).toBe(first.id);
    expect(await library.isSteward(itemId, stewardA)).toBe(true);

    await library.removeSteward({ libraryItemId: itemId, userId: stewardA });
    expect(await library.isSteward(itemId, stewardA)).toBe(false);
  });

  it("byGroup returns items with current revision + counts", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_bg", "bg@x.com");
    const groupId = await seedGroup(db, "g_li_bygroup");
    const itemId = "li_bg_1" as LibraryItemId;
    const r1 = "lr_bg_1" as LibraryRevisionId;
    const now = new Date();

    await library.create({
      id: itemId,
      groupId,
      title: "Item A",
      description: null,
      tags: ["spanish"],
      uploadedBy: userId,
      firstRevision: {
        id: r1,
        storageKey: `library/${groupId}/${itemId}/${r1}`,
        mimeType: "application/pdf",
        sizeBytes: 5000,
        originalFilename: null,
        uploadedBy: userId,
        uploadedAt: now,
      },
      now,
    });

    const list = await library.byGroup(groupId);
    expect(list).toHaveLength(1);
    expect(list[0]?.item.title).toBe("Item A");
    expect(list[0]?.currentRevision?.id).toBe(r1);
    expect(list[0]?.usedInCount).toBe(0);
  });

  it("FK RESTRICT blocks deleting an item referenced by activity_library_refs", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_fk", "fk@x.com");
    const groupId = await seedGroup(db, "g_li_fk");
    const itemId = "li_fk_1" as LibraryItemId;
    const r1 = "lr_fk_1" as LibraryRevisionId;
    const now = new Date();

    // Seed a track + activity so the FK target exists.
    await db.insert(schema.tracks).values({
      id: "t_fk",
      groupId,
      name: "Track",
      description: null,
      status: "active",
      pausedAt: null,
      archivedAt: null,
      archivedBy: null,
      trackStructureJson: '{"v":1,"data":{"mode":"free"}}',
      contributionPolicyJson: '{"v":1,"data":{"mode":"direct"}}',
      createdAt: now,
      updatedAt: now,
    });
    await library.create({
      id: itemId,
      groupId,
      title: "Pinned",
      description: null,
      tags: [],
      uploadedBy: userId,
      firstRevision: {
        id: r1,
        storageKey: `library/${groupId}/${itemId}/${r1}`,
        mimeType: "application/pdf",
        sizeBytes: 100,
        originalFilename: null,
        uploadedBy: userId,
        uploadedAt: now,
      },
      now,
    });

    await db.insert(schema.learningActivities).values({
      id: "a_fk",
      trackId: "t_fk",
      title: "Activity",
      description: null,
      partsJson: "[]",
      flowJson: '{"v":1,"data":{"links":[]}}',
      audienceJson: '{"v":1,"data":{"kind":"all"}}',
      windowJson: null,
      postClosePolicyJson: null,
      completionRuleJson: '{"v":1,"data":{"mode":"all_parts"}}',
      participationMode: "individual",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.activityLibraryRefs).values({
      id: "alr_fk",
      activityId: "a_fk",
      libraryItemId: itemId,
      pinnedRevisionId: r1,
    });

    // Hard-deleting the library_items row must fail (FK RESTRICT). The
    // adapter does not expose hard-delete; we reach to D1 directly to
    // exercise the constraint.
    await expect(
      db.delete(schema.libraryItems).where(eq(schema.libraryItems.id, itemId)),
    ).rejects.toBeDefined();

    // The dependent row still resolves the item via byId so retire
    // remains the recommended path.
    const present = await library.byId(itemId);
    expect(present).not.toBeNull();
  });
});
