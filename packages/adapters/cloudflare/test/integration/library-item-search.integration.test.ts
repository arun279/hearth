import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type { LibraryItemId, LibraryRevisionId, StudyGroupId, UserId } from "@hearth/domain";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createLibraryItemRepository } from "../../src/library-item-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Behaviour the FTS5 indexes + cursor pagination only exercise against
 * a real D1 + the hand-written triggers (migrations 0001 + 0008):
 *   - tag values are searchable as well as title and description (the
 *     migration-0008 triggers extract them from `tags_json`);
 *   - changing tags propagates to the FTS index;
 *   - retired items are excluded from search (but the row stays
 *     reachable by id);
 *   - cross-group queries do not leak hits;
 *   - keyset pagination yields exactly the next page on the next call;
 *   - `restoreFtsIndex()` rebuilds the index after a wipe.
 */
describe("library-item search (real D1 + FTS5)", () => {
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
      name: "Search Test Group",
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

  type CreateOpts = {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly tags: readonly string[];
    readonly uploadedAt?: Date;
  };

  async function createItem(
    library: ReturnType<typeof buildRepo>["library"],
    groupId: StudyGroupId,
    userId: UserId,
    opts: CreateOpts,
  ): Promise<LibraryItemId> {
    const itemId = opts.id as LibraryItemId;
    const revisionId = `${opts.id}_r1` as LibraryRevisionId;
    const now = opts.uploadedAt ?? new Date();
    await library.create({
      id: itemId,
      groupId,
      title: opts.title,
      description: opts.description,
      tags: opts.tags,
      uploadedBy: userId,
      firstRevision: {
        id: revisionId,
        storageKey: `library/${groupId}/${itemId}/${revisionId}`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        originalFilename: null,
        uploadedBy: userId,
        uploadedAt: now,
      },
      now,
    });
    return itemId;
  }

  it("matches on title", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_title", "title@x.com");
    const groupId = await seedGroup(db, "g_search_title");

    const itemId = await createItem(library, groupId, userId, {
      id: "li_search_title_1",
      title: "Beginner Spanish primer",
      description: null,
      tags: [],
    });

    const page = await library.search(groupId, {
      query: '"spanish"',
      limit: 25,
      cursor: null,
    });
    expect(page.entries.map((e) => e.item.id)).toEqual([itemId]);
    expect(page.nextCursor).toBeNull();
  });

  it("matches on description", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_desc", "desc@x.com");
    const groupId = await seedGroup(db, "g_search_desc");

    const itemId = await createItem(library, groupId, userId, {
      id: "li_search_desc_1",
      title: "Untitled",
      description: "Reflections on regional dialects",
      tags: [],
    });

    const page = await library.search(groupId, {
      query: '"dialects"',
      limit: 25,
      cursor: null,
    });
    expect(page.entries.map((e) => e.item.id)).toEqual([itemId]);
  });

  it("matches on tag values populated by the migration-0008 trigger", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_tag", "tag@x.com");
    const groupId = await seedGroup(db, "g_search_tag");

    const itemId = await createItem(library, groupId, userId, {
      id: "li_search_tag_1",
      title: "Untitled handout",
      description: null,
      tags: ["grammar", "review"],
    });

    const page = await library.search(groupId, {
      query: '"grammar"',
      limit: 25,
      cursor: null,
    });
    expect(page.entries.map((e) => e.item.id)).toEqual([itemId]);
  });

  it("re-indexes the tag column when tags_json changes", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_retag", "retag@x.com");
    const groupId = await seedGroup(db, "g_search_retag");

    const itemId = await createItem(library, groupId, userId, {
      id: "li_search_retag_1",
      title: "Notes",
      description: null,
      tags: ["draft"],
    });

    const before = await library.search(groupId, {
      query: '"published"',
      limit: 25,
      cursor: null,
    });
    expect(before.entries).toHaveLength(0);

    await library.updateMetadata(itemId, { tags: ["published"] });

    const after = await library.search(groupId, {
      query: '"published"',
      limit: 25,
      cursor: null,
    });
    expect(after.entries.map((e) => e.item.id)).toEqual([itemId]);
  });

  it("does not leak hits across groups", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_iso", "iso@x.com");
    const groupA = await seedGroup(db, "g_search_iso_a");
    const groupB = await seedGroup(db, "g_search_iso_b");

    await createItem(library, groupA, userId, {
      id: "li_iso_a",
      title: "Spanish",
      description: null,
      tags: [],
    });
    const inB = await createItem(library, groupB, userId, {
      id: "li_iso_b",
      title: "Spanish in B",
      description: null,
      tags: [],
    });

    const aPage = await library.search(groupA, {
      query: '"spanish"',
      limit: 25,
      cursor: null,
    });
    const bPage = await library.search(groupB, {
      query: '"spanish"',
      limit: 25,
      cursor: null,
    });
    expect(aPage.entries.map((e) => e.item.id)).toEqual(["li_iso_a"]);
    expect(bPage.entries.map((e) => e.item.id)).toEqual([inB]);
  });

  it("excludes retired items from search results", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_retired", "retired@x.com");
    const groupId = await seedGroup(db, "g_search_retired");

    const itemId = await createItem(library, groupId, userId, {
      id: "li_search_retired_1",
      title: "Greetings",
      description: null,
      tags: [],
    });
    await library.markRetired(itemId, userId, new Date());

    const page = await library.search(groupId, {
      query: '"greetings"',
      limit: 25,
      cursor: null,
    });
    expect(page.entries).toHaveLength(0);

    // Still reachable by id — historical activity-record links must not 404.
    const direct = await library.byId(itemId);
    expect(direct?.retiredAt).not.toBeNull();
  });

  it("paginates via opaque cursor and stops when exhausted", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_paged", "paged@x.com");
    const groupId = await seedGroup(db, "g_search_paged");

    const ids: string[] = [];
    const baseTime = new Date("2026-04-01T00:00:00.000Z").getTime();
    for (let i = 0; i < 5; i++) {
      const itemId = await createItem(library, groupId, userId, {
        id: `li_paged_${i}`,
        title: `Spanish lesson ${i}`,
        description: null,
        tags: [],
        // Distinct uploadedAt so the second-tier sort is deterministic.
        uploadedAt: new Date(baseTime + i * 1000),
      });
      ids.push(itemId);
    }

    const first = await library.search(groupId, {
      query: '"spanish"',
      limit: 2,
      cursor: null,
    });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await library.search(groupId, {
      query: '"spanish"',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.entries).toHaveLength(2);

    const third = await library.search(groupId, {
      query: '"spanish"',
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.entries).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const seen = [
      ...first.entries.map((e) => e.item.id),
      ...second.entries.map((e) => e.item.id),
      ...third.entries.map((e) => e.item.id),
    ];
    expect(new Set(seen).size).toBe(5);
  });

  it("returns the LibraryItemListEntry shape with currentRevision and counts", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_shape", "shape@x.com");
    const groupId = await seedGroup(db, "g_search_shape");

    const itemId = await createItem(library, groupId, userId, {
      id: "li_search_shape_1",
      title: "Shape test",
      description: null,
      tags: ["alpha"],
    });

    const page = await library.search(groupId, {
      query: '"alpha"',
      limit: 25,
      cursor: null,
    });
    expect(page.entries).toHaveLength(1);
    const entry = page.entries[0];
    if (!entry) throw new Error("expected one entry");
    expect(entry.item.id).toBe(itemId);
    expect(entry.currentRevision?.mimeType).toBe("application/pdf");
    expect(entry.stewardCount).toBe(0);
    expect(entry.usedInCount).toBe(0);
  });

  it("restoreFtsIndex rebuilds the FTS5 index from library_items", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_restore_fts", "restore@x.com");
    const groupId = await seedGroup(db, "g_restore_fts");

    const itemId = await createItem(library, groupId, userId, {
      id: "li_restore_fts_1",
      title: "Restorable",
      description: null,
      tags: ["alpha"],
    });

    // Drop every row from the FTS index to simulate a `wrangler d1 export`
    // restore that ran before the FTS rebuild step (export skips virtuals).
    await db.run(sql`DELETE FROM library_items_fts`);
    const before = await library.search(groupId, {
      query: '"restorable"',
      limit: 25,
      cursor: null,
    });
    expect(before.entries).toHaveLength(0);

    const result = await library.restoreFtsIndex();
    expect(result.rebuilt).toBeGreaterThanOrEqual(1);

    const after = await library.search(groupId, {
      query: '"restorable"',
      limit: 25,
      cursor: null,
    });
    expect(after.entries.map((e) => e.item.id)).toEqual([itemId]);
  });

  it("returns an empty page for a query with no matches", async () => {
    const { db, library } = buildRepo();
    const userId = await seedUser(db, "u_search_nohit", "nohit@x.com");
    const groupId = await seedGroup(db, "g_search_nohit");

    await createItem(library, groupId, userId, {
      id: "li_search_nohit_1",
      title: "Greetings",
      description: null,
      tags: [],
    });

    const page = await library.search(groupId, {
      query: '"asdfqwer"',
      limit: 25,
      cursor: null,
    });
    expect(page.entries).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });
});
