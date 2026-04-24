import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

/**
 * The FTS5 virtual table + triggers ship in migration `0001_library_fts5.sql`.
 * Drizzle does not own virtuals, so this is the only place those triggers
 * are covered. Insert/update/delete on `library_items` must keep
 * `library_items_fts` in lockstep.
 *
 * The MATCH query at the end also confirms the virtual table is queryable
 * (Miniflare's workerd ships SQLite with FTS5 compiled in — if this test
 * were ever to fail to load the virtual table, something in the workerd
 * build has regressed).
 */

type FtsRow = {
  readonly library_item_id: string;
  readonly title: string;
  readonly description: string;
};

describe("library_items_fts triggers (real D1)", () => {
  async function seedUserAndGroup(db: ReturnType<typeof drizzle<typeof schema>>) {
    const now = new Date();
    const uid = "u_fts_owner";
    const gid = "g_fts_group";
    await db.insert(schema.users).values({
      id: uid,
      email: "owner@example.com",
      emailVerified: false,
      name: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.groups).values({
      id: gid,
      name: "FTS Test Group",
      description: null,
      admissionPolicy: "invite_only",
      status: "active",
      archivedAt: null,
      archivedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    return { uid, gid };
  }

  async function ftsRowFor(
    db: ReturnType<typeof drizzle<typeof schema>>,
    id: string,
  ): Promise<FtsRow | null> {
    const result = await db.all<FtsRow>(
      sql`SELECT library_item_id, title, description FROM library_items_fts WHERE library_item_id = ${id}`,
    );
    return result[0] ?? null;
  }

  it("AFTER INSERT trigger mirrors the row into library_items_fts", async () => {
    const db = drizzle(env.DB, { schema });
    const { uid, gid } = await seedUserAndGroup(db);
    const now = new Date();

    await db.insert(schema.libraryItems).values({
      id: "li_insert",
      groupId: gid,
      title: "Ordering at a café",
      description: "Intro to Spanish restaurant Spanish.",
      tagsJson: "[]",
      currentRevisionId: null,
      uploadedBy: uid,
      retiredAt: null,
      retiredBy: null,
      createdAt: now,
      updatedAt: now,
    });

    const row = await ftsRowFor(db, "li_insert");
    expect(row).toEqual({
      library_item_id: "li_insert",
      title: "Ordering at a café",
      description: "Intro to Spanish restaurant Spanish.",
    });
  });

  it("AFTER UPDATE trigger rewrites the FTS row when title/description change", async () => {
    const db = drizzle(env.DB, { schema });
    const { uid, gid } = await seedUserAndGroup(db);
    const now = new Date();

    await db.insert(schema.libraryItems).values({
      id: "li_update",
      groupId: gid,
      title: "Old title",
      description: "Old body",
      tagsJson: "[]",
      currentRevisionId: null,
      uploadedBy: uid,
      retiredAt: null,
      retiredBy: null,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(schema.libraryItems)
      .set({ title: "New title", description: "New body" })
      .where(eq(schema.libraryItems.id, "li_update"));

    const row = await ftsRowFor(db, "li_update");
    expect(row?.title).toBe("New title");
    expect(row?.description).toBe("New body");
  });

  it("AFTER DELETE trigger removes the FTS row and MATCH queries reflect it", async () => {
    const db = drizzle(env.DB, { schema });
    const { uid, gid } = await seedUserAndGroup(db);
    const now = new Date();

    await db.insert(schema.libraryItems).values({
      id: "li_match",
      groupId: gid,
      title: "Greetings and introductions",
      description: "Saludos básicos",
      tagsJson: "[]",
      currentRevisionId: null,
      uploadedBy: uid,
      retiredAt: null,
      retiredBy: null,
      createdAt: now,
      updatedAt: now,
    });

    const hit = await db.all<{ readonly library_item_id: string }>(
      sql`SELECT library_item_id FROM library_items_fts WHERE library_items_fts MATCH 'greetings'`,
    );
    expect(hit.map((r) => r.library_item_id)).toContain("li_match");

    await db.delete(schema.libraryItems).where(eq(schema.libraryItems.id, "li_match"));
    const row = await ftsRowFor(db, "li_match");
    expect(row).toBeNull();
  });
});
