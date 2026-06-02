import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * `EXPLAIN QUERY PLAN` regression guard for the Activity Player's hot
 * reads. The player projection orchestrates several short queries from
 * the use case layer — the underlying adapter calls each need to hit
 * an index, not full-scan, or the read path drifts toward an N-table
 * sequential scan at 20-user-instance scale.
 *
 * Coverage:
 *   - `learning_activities` by id (PK lookup).
 *   - `activity_library_refs` filtered by `activity_id`
 *     (`activity_library_refs_unique_idx` leads with `activity_id`).
 *   - `activity_prerequisites` filtered by `activity_id`
 *     (`activity_prerequisites_unique_idx` leads with `activity_id`).
 *   - `activity_suggested_sequences` filtered by `activity_id`
 *     (`activity_suggested_sequences_unique_idx` leads with `activity_id`).
 *   - `library_revisions` by id (PK lookup; the `currentRevisionId`
 *     pointer on `library_items` makes this a single-row read).
 *
 * If a plan changes legitimately (new index, schema split), update the
 * asserted `using index` substring rather than removing the assertion
 * — the index name is the contract.
 */

type PlanRow = { readonly detail: string };

async function explain(
  sqlText: string,
  bindings: ReadonlyArray<string | number> = [],
): Promise<ReadonlyArray<PlanRow>> {
  const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sqlText}`)
    .bind(...bindings)
    .all<PlanRow>();
  return result.results ?? [];
}

function planMentions(rows: ReadonlyArray<PlanRow>, fragment: string): boolean {
  return rows.some((r) => r.detail.includes(fragment));
}

describe("activity player read paths (real D1)", () => {
  it("learning_activities by id uses the PRIMARY KEY", async () => {
    const rows = await explain("SELECT * FROM learning_activities WHERE id = ? LIMIT 1", ["a_x"]);
    // SQLite phrases PK lookups variously: "USING INTEGER PRIMARY KEY",
    // "USING ROWID", or "USING INDEX sqlite_autoindex_…". The shared
    // signal across phrasings is "PRIMARY KEY" or "rowid" — assert the
    // plan is not a full table scan.
    expect(planMentions(rows, "SCAN")).toBe(false);
  });

  it("activity_library_refs filtered by activity_id hits the unique index", async () => {
    const rows = await explain(
      "SELECT * FROM activity_library_refs WHERE activity_id = ? ORDER BY id",
      ["a_x"],
    );
    expect(planMentions(rows, "activity_library_refs_unique_idx")).toBe(true);
  });

  it("activity_prerequisites filtered by activity_id hits the unique index", async () => {
    const rows = await explain("SELECT * FROM activity_prerequisites WHERE activity_id = ?", [
      "a_x",
    ]);
    expect(planMentions(rows, "activity_prerequisites_unique_idx")).toBe(true);
  });

  it("activity_suggested_sequences filtered by activity_id hits the unique index", async () => {
    const rows = await explain("SELECT * FROM activity_suggested_sequences WHERE activity_id = ?", [
      "a_x",
    ]);
    expect(planMentions(rows, "activity_suggested_sequences_unique_idx")).toBe(true);
  });

  it("library_revisions by id is a PK lookup (pinned-revision resolution)", async () => {
    const rows = await explain("SELECT * FROM library_revisions WHERE id = ? LIMIT 1", ["lr_x"]);
    expect(planMentions(rows, "SCAN")).toBe(false);
  });

  it("library_items by id is a PK lookup (current-revision pointer dereference)", async () => {
    const rows = await explain("SELECT * FROM library_items WHERE id = ? LIMIT 1", ["li_x"]);
    expect(planMentions(rows, "SCAN")).toBe(false);
  });
});
