import { groupMemberships, groups, libraryItems, tracks } from "@hearth/db/schema";
import {
  type AdmissionPolicy,
  DomainError,
  type GroupMembership,
  type GroupRole,
  type GroupStatus,
  type StudyGroup,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import type { StudyGroupCounts, StudyGroupRepository } from "@hearth/ports";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { createIdGenerator } from "./id-generator.ts";

function toGroup(r: typeof groups.$inferSelect): StudyGroup {
  return {
    id: r.id as StudyGroupId,
    name: r.name,
    description: r.description,
    admissionPolicy: r.admissionPolicy as AdmissionPolicy,
    status: r.status as GroupStatus,
    archivedAt: r.archivedAt,
    archivedBy: r.archivedBy === null ? null : (r.archivedBy as UserId),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toMembership(r: typeof groupMemberships.$inferSelect): GroupMembership {
  return {
    groupId: r.groupId as StudyGroupId,
    userId: r.userId as UserId,
    role: r.role as GroupRole,
    joinedAt: r.joinedAt,
    removedAt: r.removedAt,
  };
}

/**
 * Real D1 implementation of `StudyGroupRepository`. Mutation methods call
 * `gate.assertWritable()` first so the killswitch flips block writes even
 * when the HTTP middleware is bypassed (scheduled tasks, future internal
 * callers).
 *
 * Atomicity guarantees:
 * - `create` inserts the group row + the creator's first admin membership
 *   in one D1 batch (single round-trip, single SQLite transaction). There
 *   is no observable window in which a group exists without an admin.
 * - `updateStatus` and `updateMetadata` use a single conditional UPDATE so
 *   concurrent flips do not lose the "currently archived" guard.
 *
 * Reads piggy-back the indexes declared in the schema: `(groupId, userId)`
 * for memberships, `(userId)` for membership lookups, `(groupId, role)` for
 * the admin count.
 */
export function createStudyGroupRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): StudyGroupRepository {
  // The repository owns its own id generator so the adapter's composition
  // root does not need to thread the ports' `IdGenerator` for write methods
  // that mint child rows (memberships) alongside the parent. The generator
  // is a pure function — instantiating per repo is cheap.
  const ids = createIdGenerator();

  return {
    async create({ name, description, createdBy }) {
      await deps.gate.assertWritable();
      const id = ids.generate() as StudyGroupId;
      const membershipId = ids.generate();
      const now = new Date();

      // Single D1 batch — both statements commit atomically. SQLite reports
      // the entire batch as one transaction; partial application is not
      // possible. The orphan-admin invariant is satisfied at row 0.
      await deps.db.batch([
        deps.db.insert(groups).values({
          id,
          name,
          description: description ?? null,
          admissionPolicy: "invite_only",
          status: "active",
          archivedAt: null,
          archivedBy: null,
          createdAt: now,
          updatedAt: now,
        }),
        deps.db.insert(groupMemberships).values({
          id: membershipId,
          groupId: id,
          userId: createdBy,
          role: "admin",
          joinedAt: now,
          removedAt: null,
        }),
      ]);

      // Read-after-write: D1 is single-leader, this read sees the just-
      // committed batch. We construct from inputs rather than re-reading
      // to keep the path to one round-trip.
      return {
        id,
        name,
        description: description ?? null,
        admissionPolicy: "invite_only",
        status: "active",
        archivedAt: null,
        archivedBy: null,
        createdAt: now,
        updatedAt: now,
      };
    },

    async byId(id) {
      const rows = await deps.db.select().from(groups).where(eq(groups.id, id)).limit(1);
      return rows[0] ? toGroup(rows[0]) : null;
    },

    async list(opts) {
      const baseQuery = deps.db.select().from(groups);
      const rows = opts?.status
        ? await baseQuery.where(eq(groups.status, opts.status))
        : await baseQuery;
      return rows.map(toGroup);
    },

    async listForUser(userId) {
      // Index hit on group_memberships_user_idx → join to groups by PK.
      // Excludes removed memberships so an ex-member does not see a stale
      // row in their picker.
      const rows = await deps.db
        .select({
          id: groups.id,
          name: groups.name,
          description: groups.description,
          admissionPolicy: groups.admissionPolicy,
          status: groups.status,
          archivedAt: groups.archivedAt,
          archivedBy: groups.archivedBy,
          createdAt: groups.createdAt,
          updatedAt: groups.updatedAt,
        })
        .from(groups)
        .where(
          exists(
            deps.db
              .select({ n: sql<number>`1` })
              .from(groupMemberships)
              .where(
                and(
                  eq(groupMemberships.groupId, groups.id),
                  eq(groupMemberships.userId, userId),
                  isNull(groupMemberships.removedAt),
                ),
              ),
          ),
        );
      return rows.map(toGroup);
    },

    async updateStatus(id, status, by) {
      await deps.gate.assertWritable();
      const now = new Date();

      // archive: only if currently active. unarchive: only if currently
      // archived. Either flip is a single UPDATE — concurrent flips race
      // safely because the WHERE clause filters on the prior state.
      if (status === "archived") {
        await deps.db
          .update(groups)
          .set({ status: "archived", archivedAt: now, archivedBy: by, updatedAt: now })
          .where(and(eq(groups.id, id), eq(groups.status, "active")));
      } else {
        await deps.db
          .update(groups)
          .set({ status: "active", archivedAt: null, archivedBy: null, updatedAt: now })
          .where(and(eq(groups.id, id), eq(groups.status, "archived")));
      }
      // No throw on zero-rows: callers treat updateStatus as idempotent
      // (no-op when already at the target status).
    },

    async updateMetadata(id, patch, _by) {
      await deps.gate.assertWritable();
      const existing = await deps.db.select().from(groups).where(eq(groups.id, id)).limit(1);
      const row = existing[0];
      if (!row) {
        throw new DomainError("NOT_FOUND", "Group not found", "not_found");
      }
      if (row.status === "archived") {
        // Use CONFLICT (409) over INVARIANT_VIOLATION so the SPA can
        // distinguish "the group changed under you" from validation issues.
        throw new DomainError(
          "CONFLICT",
          "Archived groups do not allow metadata edits.",
          "group_archived",
        );
      }
      const now = new Date();
      const next = {
        name: patch.name ?? row.name,
        description: patch.description === undefined ? row.description : patch.description,
        updatedAt: now,
      };
      // Conditional UPDATE closes the SELECT-then-UPDATE race: if a concurrent
      // request archives the group between our SELECT and this UPDATE, the
      // WHERE clause no longer matches and the UPDATE is a no-op. Without
      // this clause, metadata could land on an already-archived row,
      // violating the "archived groups are frozen" contract.
      const updated = await deps.db
        .update(groups)
        .set(next)
        .where(and(eq(groups.id, id), eq(groups.status, "active")))
        .returning({ id: groups.id });
      if (updated.length === 0) {
        throw new DomainError(
          "CONFLICT",
          "Archived groups do not allow metadata edits.",
          "group_archived",
        );
      }
      return toGroup({ ...row, ...next });
    },

    async membership(groupId, userId) {
      const rows = await deps.db
        .select()
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
        .limit(1);
      return rows[0] ? toMembership(rows[0]) : null;
    },

    async membershipsForUser(userId) {
      const rows = await deps.db
        .select()
        .from(groupMemberships)
        .where(and(eq(groupMemberships.userId, userId), isNull(groupMemberships.removedAt)));
      return rows.map(toMembership);
    },

    async countAdmins(groupId) {
      const rows = await deps.db
        .select({ n: sql<number>`count(*)` })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, groupId),
            eq(groupMemberships.role, "admin"),
            isNull(groupMemberships.removedAt),
          ),
        );
      return Number(rows[0]?.n ?? 0);
    },

    async counts(groupId): Promise<StudyGroupCounts> {
      // `trackCount` / `libraryItemCount` will read 0 until those tables
      // have rows. Surfacing the fields here (rather than gating them
      // behind the aggregates landing) keeps the SPA's group-home shape
      // stable so the response contract doesn't shift between milestones.
      const [memberRows, trackRows, libraryRows] = await Promise.all([
        deps.db
          .select({ n: sql<number>`count(*)` })
          .from(groupMemberships)
          .where(and(eq(groupMemberships.groupId, groupId), isNull(groupMemberships.removedAt))),
        deps.db
          .select({ n: sql<number>`count(*)` })
          .from(tracks)
          .where(eq(tracks.groupId, groupId)),
        deps.db
          .select({ n: sql<number>`count(*)` })
          .from(libraryItems)
          .where(and(eq(libraryItems.groupId, groupId), isNull(libraryItems.retiredAt))),
      ]);
      return {
        memberCount: Number(memberRows[0]?.n ?? 0),
        trackCount: Number(trackRows[0]?.n ?? 0),
        libraryItemCount: Number(libraryRows[0]?.n ?? 0),
      };
    },
  };
}
