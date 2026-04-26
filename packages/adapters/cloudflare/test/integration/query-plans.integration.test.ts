import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * `EXPLAIN QUERY PLAN` regression guard. The membership / invitation
 * surface ships with declared indexes in `packages/db/src/schema/`:
 *
 *   - `group_memberships_group_user_idx` UNIQUE on (groupId, userId)
 *   - `group_memberships_user_idx`        on (userId)
 *   - `group_invitations_token_unique`    UNIQUE on (token)
 *   - `group_invitations_expires_idx`     on (expiresAt)
 *
 * The integration tests exercise those queries functionally, but a
 * regression that drops or shadows an index — or a WHERE-clause shape
 * that diverges from the index's column order so SQLite falls back to a
 * full scan — wouldn't surface as a wrong answer. It would surface as
 * 100× slower at scale. SQLite's `EXPLAIN QUERY PLAN` output names the
 * index when one is hit; this test asserts that the canonical reads
 * named in the M3 schema commentary still hit them.
 *
 * If a query plan changes legitimately (new query shape, schema split),
 * update the asserted `using index` substring rather than removing the
 * test — the substring is the contract.
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

describe("query plans (real D1)", () => {
  it("listMemberships hits group_memberships_group_user_idx (or covering equiv)", async () => {
    // The drizzle query is `WHERE groupId = ? AND removedAt IS NULL`.
    // SQLite's planner uses the leading column of the unique index
    // (`group_id`) for the equality scan; the `removedAt IS NULL`
    // filter is an additional predicate applied per row. The plan
    // string therefore mentions the index by name.
    const rows = await explain(
      "SELECT * FROM group_memberships WHERE group_id = ? AND removed_at IS NULL ORDER BY joined_at",
      ["g_test"],
    );
    expect(planMentions(rows, "group_memberships_group_user_idx")).toBe(true);
  });

  it("countAdmins hits group_memberships_group_user_idx (filtered by role)", async () => {
    const rows = await explain(
      "SELECT count(*) FROM group_memberships WHERE group_id = ? AND role = 'admin' AND removed_at IS NULL",
      ["g_test"],
    );
    expect(planMentions(rows, "group_memberships_group_user_idx")).toBe(true);
  });

  it("membershipsForUser hits group_memberships_user_idx", async () => {
    const rows = await explain(
      "SELECT * FROM group_memberships WHERE user_id = ? AND removed_at IS NULL",
      ["u_test"],
    );
    expect(planMentions(rows, "group_memberships_user_idx")).toBe(true);
  });

  it("invitationByToken hits group_invitations_token_unique", async () => {
    const rows = await explain("SELECT * FROM group_invitations WHERE token = ? LIMIT 1", [
      "tok-x",
    ]);
    expect(planMentions(rows, "group_invitations_token_unique")).toBe(true);
  });

  it("listPendingInvitations uses an index — not a full scan", async () => {
    // The `WHERE groupId = ? AND consumedAt IS NULL AND revokedAt IS
    // NULL AND expiresAt > ?` shape doesn't have a perfect covering
    // index, but SQLite must still pick something better than a full
    // scan. Asserting "not a SCAN" is the durable invariant.
    const rows = await explain(
      "SELECT * FROM group_invitations WHERE group_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at",
      ["g_test", 0],
    );
    expect(planMentions(rows, "SCAN group_invitations")).toBe(false);
  });

  it("pending_uploads sweep hits pending_uploads_expires_at_idx", async () => {
    // The cron's hot-path SELECT is `WHERE expiresAt < ?` — the index
    // covers the column directly. A scan here would mean every row
    // gets touched on every firing.
    const rows = await explain(
      "SELECT id, revision_id, context FROM pending_uploads WHERE expires_at < ? LIMIT 200",
      [0],
    );
    expect(planMentions(rows, "pending_uploads_expires_at_idx")).toBe(true);
  });
});
