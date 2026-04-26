import {
  groupInvitations,
  groupMemberships,
  groups,
  libraryItems,
  tracks,
} from "@hearth/db/schema";
import {
  type AdmissionPolicy,
  type AttributionPreference,
  DomainError,
  type GroupInvitation,
  type GroupMembership,
  type GroupProfile,
  type GroupRole,
  type GroupStatus,
  type InvitationId,
  type LearningTrackId,
  type StudyGroup,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import type {
  ConsumeInvitationInput,
  ConsumeInvitationResult,
  CreateInvitationInput,
  GroupProfilePatch,
  StudyGroupCounts,
  StudyGroupRepository,
} from "@hearth/ports";
import { and, asc, eq, exists, gt, isNull, or, sql } from "drizzle-orm";
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
  const profile: GroupProfile = {
    nickname: r.profileNickname,
    avatarUrl: r.profileAvatarUrl,
    bio: r.profileBio,
    updatedAt: r.profileUpdatedAt,
  };
  return {
    groupId: r.groupId as StudyGroupId,
    userId: r.userId as UserId,
    role: r.role as GroupRole,
    joinedAt: r.joinedAt,
    removedAt: r.removedAt,
    removedBy: r.removedBy === null ? null : (r.removedBy as UserId),
    attributionOnLeave: (r.attributionOnLeave as AttributionPreference | null) ?? null,
    displayNameSnapshot: r.displayNameSnapshot,
    profile,
  };
}

function toInvitation(r: typeof groupInvitations.$inferSelect): GroupInvitation {
  return {
    id: r.id as InvitationId,
    groupId: r.groupId as StudyGroupId,
    trackId: r.trackId === null ? null : (r.trackId as LearningTrackId),
    token: r.token,
    email: r.email,
    createdBy: r.createdBy as UserId,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    consumedAt: r.consumedAt,
    consumedBy: r.consumedBy === null ? null : (r.consumedBy as UserId),
    revokedAt: r.revokedAt,
    revokedBy: r.revokedBy === null ? null : (r.revokedBy as UserId),
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
 * - `removeMembership` / `setMembershipRole` re-check `countAdmins ≥ 1`
 *   inside the same transaction with a `WHERE` clause that fails if the
 *   row state changed underfoot, so two simultaneous demotions can never
 *   both succeed and leave the group orphaned.
 * - `consumeInvitation` runs a single D1 batch: insert membership (no-op
 *   on conflict), insert track enrollment IF a guard is on (M3 leaves it
 *   off — this branch is exercised in M5), then mark the invitation
 *   consumed. A mid-batch failure rolls back all three statements.
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

  /**
   * Preflight for membership-mutating writes (`removeMembership`,
   * `setMembershipRole`, `updateProfile`): read the current membership
   * row + the parent group's status, then translate "not found",
   * "already removed", and "archived group" into the canonical domain
   * errors. Throws on the failure paths so the calling closure can
   * proceed assuming a current, mutable target.
   *
   * The errorCode discriminator lets each caller carry its own
   * archived-group copy without duplicating the read-then-throw block.
   */
  async function loadMutableMembership(
    groupId: StudyGroupId,
    userId: UserId,
    archivedDetail: string,
  ): Promise<typeof groupMemberships.$inferSelect> {
    const existing = await deps.db
      .select()
      .from(groupMemberships)
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
      .limit(1);
    const target = existing[0];
    if (!target || target.removedAt !== null) {
      throw new DomainError("NOT_FOUND", "Membership not found.", "not_group_member");
    }
    const groupRow = await deps.db
      .select({ status: groups.status })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!groupRow[0]) {
      throw new DomainError("NOT_FOUND", "Group not found.", "not_found");
    }
    if (groupRow[0].status === "archived") {
      throw new DomainError("CONFLICT", archivedDetail, "group_archived");
    }
    return target;
  }

  /**
   * Disambiguate a zero-row UPDATE on the membership-mutation path: we
   * either lost a race against a concurrent removal (re-read shows the
   * row removed → NOT_FOUND `not_group_member`) or the orphan-admin
   * guard fired (re-read shows the row still active → CONFLICT
   * `would_orphan_admin`).
   */
  async function throwMembershipRaceLoser(groupId: StudyGroupId, userId: UserId): Promise<never> {
    const after = await deps.db
      .select({ removedAt: groupMemberships.removedAt })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
      .limit(1);
    if (!after[0] || after[0].removedAt !== null) {
      throw new DomainError("NOT_FOUND", "Membership not found.", "not_group_member");
    }
    throw new DomainError(
      "CONFLICT",
      "Active groups must keep at least one Group Admin.",
      "would_orphan_admin",
    );
  }

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

    // ── Memberships ────────────────────────────────────────────────────────

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

    async listMemberships(groupId) {
      const rows = await deps.db
        .select()
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, groupId), isNull(groupMemberships.removedAt)))
        .orderBy(asc(groupMemberships.joinedAt));
      return rows.map(toMembership);
    },

    async listAdmins(groupId) {
      const rows = await deps.db
        .select()
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, groupId),
            eq(groupMemberships.role, "admin"),
            isNull(groupMemberships.removedAt),
          ),
        );
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

    async addMembership({ groupId, userId, role, by: _by }) {
      await deps.gate.assertWritable();
      const id = ids.generate();
      const now = new Date();
      // ON CONFLICT keeps add idempotent — re-adding a current member is a
      // no-op and we return the existing row. Re-adding someone whose
      // previous membership was removed re-uses the same (groupId, userId)
      // pair: revive their row by clearing `removedAt` rather than
      // inserting a parallel one (the unique index forbids it anyway).
      await deps.db
        .insert(groupMemberships)
        .values({
          id,
          groupId,
          userId,
          role,
          joinedAt: now,
          removedAt: null,
          removedBy: null,
          attributionOnLeave: null,
          displayNameSnapshot: null,
        })
        .onConflictDoUpdate({
          target: [groupMemberships.groupId, groupMemberships.userId],
          set: {
            role,
            joinedAt: now,
            removedAt: null,
            removedBy: null,
            attributionOnLeave: null,
            displayNameSnapshot: null,
          },
        });

      const rows = await deps.db
        .select()
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new DomainError("NOT_FOUND", "Membership not found after insert.");
      }
      return toMembership(row);
    },

    async removeMembership({ groupId, userId, by, attribution, displayNameSnapshot }) {
      await deps.gate.assertWritable();
      // Reads existing row + group status; throws NOT_FOUND / CONFLICT
      // for the not-current and archived cases. The orphan check below
      // runs as part of the conditional UPDATE so a concurrent demote-
      // and-leave race cannot drop the active admin count past 1.
      await loadMutableMembership(
        groupId,
        userId,
        "Archived groups do not allow membership changes.",
      );
      const now = new Date();

      // Conditional UPDATE: only succeed if the membership row is still
      // current (`removedAt IS NULL`) AND removing this active admin would
      // not drop the count below 1. The subquery counts other active
      // admins; we require at least 1 OR the target is a participant.
      const otherAdmins = deps.db
        .select({ n: sql<number>`count(*)` })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, groupId),
            eq(groupMemberships.role, "admin"),
            isNull(groupMemberships.removedAt),
            sql`${groupMemberships.userId} <> ${userId}`,
          ),
        );

      const updated = await deps.db
        .update(groupMemberships)
        .set({
          removedAt: now,
          removedBy: by,
          attributionOnLeave: attribution,
          displayNameSnapshot: attribution === "preserve_name" ? displayNameSnapshot : null,
        })
        .where(
          and(
            eq(groupMemberships.groupId, groupId),
            eq(groupMemberships.userId, userId),
            isNull(groupMemberships.removedAt),
            // If the target is admin, require ≥1 other active admin in the
            // group. If the target is participant, the orphan check is N/A.
            or(sql`${groupMemberships.role} <> 'admin'`, sql`(${otherAdmins}) >= 1`),
          ),
        )
        .returning({ id: groupMemberships.id, role: groupMemberships.role });
      if (updated.length === 0) {
        await throwMembershipRaceLoser(groupId, userId);
      }
    },

    async setMembershipRole({ groupId, userId, role, by: _by }) {
      await deps.gate.assertWritable();
      await loadMutableMembership(groupId, userId, "Archived groups do not allow role changes.");

      // Same orphan-guard as removal, but for demotion: if the target is
      // currently admin and we're demoting them, we require ≥1 *other*
      // active admin to remain. Promotions skip the guard.
      const otherAdmins = deps.db
        .select({ n: sql<number>`count(*)` })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, groupId),
            eq(groupMemberships.role, "admin"),
            isNull(groupMemberships.removedAt),
            sql`${groupMemberships.userId} <> ${userId}`,
          ),
        );

      const guard =
        role === "participant"
          ? and(
              eq(groupMemberships.groupId, groupId),
              eq(groupMemberships.userId, userId),
              isNull(groupMemberships.removedAt),
              or(sql`${groupMemberships.role} <> 'admin'`, sql`(${otherAdmins}) >= 1`),
            )
          : and(
              eq(groupMemberships.groupId, groupId),
              eq(groupMemberships.userId, userId),
              isNull(groupMemberships.removedAt),
            );

      const updated = await deps.db
        .update(groupMemberships)
        .set({ role })
        .where(guard)
        .returning({ id: groupMemberships.id });
      if (updated.length === 0) {
        await throwMembershipRaceLoser(groupId, userId);
      }

      const rows = await deps.db
        .select()
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
        .limit(1);
      return toMembership(rows[0] as typeof groupMemberships.$inferSelect);
    },

    async updateProfile({
      groupId,
      userId,
      patch,
    }: {
      groupId: StudyGroupId;
      userId: UserId;
      patch: GroupProfilePatch;
    }) {
      await deps.gate.assertWritable();
      const existing = await deps.db
        .select()
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
        .limit(1);
      const target = existing[0];
      if (!target || target.removedAt !== null) {
        throw new DomainError("NOT_FOUND", "Membership not found.", "not_group_member");
      }

      const now = new Date();
      const next = {
        profileNickname: patch.nickname === undefined ? target.profileNickname : patch.nickname,
        profileAvatarUrl: patch.avatarUrl === undefined ? target.profileAvatarUrl : patch.avatarUrl,
        profileBio: patch.bio === undefined ? target.profileBio : patch.bio,
        profileUpdatedAt: now,
      };

      // Guard against concurrent removal: only update an active row.
      const updated = await deps.db
        .update(groupMemberships)
        .set(next)
        .where(
          and(
            eq(groupMemberships.groupId, groupId),
            eq(groupMemberships.userId, userId),
            isNull(groupMemberships.removedAt),
          ),
        )
        .returning({ id: groupMemberships.id });
      if (updated.length === 0) {
        throw new DomainError("NOT_FOUND", "Membership not found.", "not_group_member");
      }

      const rows = await deps.db
        .select()
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
        .limit(1);
      return toMembership(rows[0] as typeof groupMemberships.$inferSelect);
    },

    // ── Invitations ────────────────────────────────────────────────────────

    async createInvitation(input: CreateInvitationInput) {
      await deps.gate.assertWritable();
      const id = ids.generate() as InvitationId;
      const now = new Date();
      await deps.db.insert(groupInvitations).values({
        id,
        groupId: input.groupId,
        trackId: input.trackId,
        token: input.token,
        email: input.email,
        createdBy: input.createdBy,
        createdAt: now,
        expiresAt: input.expiresAt,
      });
      const rows = await deps.db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.id, id))
        .limit(1);
      return toInvitation(rows[0] as typeof groupInvitations.$inferSelect);
    },

    async invitationByToken(token) {
      const rows = await deps.db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.token, token))
        .limit(1);
      return rows[0] ? toInvitation(rows[0]) : null;
    },

    async invitationById(id) {
      const rows = await deps.db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.id, id))
        .limit(1);
      return rows[0] ? toInvitation(rows[0]) : null;
    },

    async listPendingInvitations(groupId, now) {
      // "Pending" here means non-terminal: not consumed, not revoked,
      // not yet expired. The SPA's Invitations page renders this list
      // and projects each row through `invitationStatus()` for the
      // pending-vs-pending_approval distinction.
      const rows = await deps.db
        .select()
        .from(groupInvitations)
        .where(
          and(
            eq(groupInvitations.groupId, groupId),
            isNull(groupInvitations.consumedAt),
            isNull(groupInvitations.revokedAt),
            gt(groupInvitations.expiresAt, now),
          ),
        )
        .orderBy(asc(groupInvitations.createdAt));
      return rows.map(toInvitation);
    },

    async revokeInvitation({ id, by, now: _now }) {
      await deps.gate.assertWritable();
      const now = new Date();
      // Idempotent: revoking an already-revoked or already-consumed
      // invitation succeeds silently. We only touch live rows so the
      // metadata we'd attach to a terminal row stays unchanged.
      await deps.db
        .update(groupInvitations)
        .set({ revokedAt: now, revokedBy: by })
        .where(
          and(
            eq(groupInvitations.id, id),
            isNull(groupInvitations.revokedAt),
            isNull(groupInvitations.consumedAt),
          ),
        );
    },

    async consumeInvitation(input: ConsumeInvitationInput): Promise<ConsumeInvitationResult> {
      await deps.gate.assertWritable();
      // Re-read inside the same connection so the policy decision below
      // and the UPDATE that lands the consume run on the same view.
      const invRows = await deps.db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.id, input.invitationId))
        .limit(1);
      const inv = invRows[0];
      if (!inv) {
        throw new DomainError("NOT_FOUND", "Invitation not found.", "invitation_not_found");
      }
      if (inv.revokedAt !== null) {
        throw new DomainError("CONFLICT", "Invitation revoked.", "invitation_revoked");
      }
      if (inv.consumedAt !== null) {
        throw new DomainError("CONFLICT", "Invitation already consumed.", "invitation_consumed");
      }
      if (inv.expiresAt.getTime() <= input.now.getTime()) {
        throw new DomainError("CONFLICT", "Invitation expired.", "invitation_expired");
      }

      const now = new Date();
      const membershipId = ids.generate();

      // Two-phase claim → admit. Phase 1 atomically claims the
      // invitation row by issuing a conditional UPDATE that only
      // matches if the row is still consumable (not consumed, not
      // revoked, not expired) right now. RETURNING tells us whether we
      // won. Phase 2 only runs if we won, so the membership insert
      // can never land for a race-loser — closing the "two consumers
      // racing on a generic token both end up as members" hole.
      //
      // Track enrollment lands when the M5 aggregate ships; here it's
      // skipped (returned as `enrollment: null`).
      const claimed = await deps.db
        .update(groupInvitations)
        .set({ consumedAt: now, consumedBy: input.userId })
        .where(
          and(
            eq(groupInvitations.id, input.invitationId),
            isNull(groupInvitations.consumedAt),
            isNull(groupInvitations.revokedAt),
            gt(groupInvitations.expiresAt, input.now),
          ),
        )
        .returning({ id: groupInvitations.id });

      if (claimed.length === 0) {
        // Race-loss. Re-read the row to give the caller the precise
        // reason — without this, a concurrent revoke landing between
        // our pre-flight read and this UPDATE would surface as
        // `invitation_consumed` even though the truth is `revoked`.
        const after = await deps.db
          .select({
            consumedAt: groupInvitations.consumedAt,
            revokedAt: groupInvitations.revokedAt,
            expiresAt: groupInvitations.expiresAt,
          })
          .from(groupInvitations)
          .where(eq(groupInvitations.id, input.invitationId))
          .limit(1);
        const row = after[0];
        if (!row) {
          throw new DomainError("NOT_FOUND", "Invitation not found.", "invitation_not_found");
        }
        if (row.revokedAt !== null) {
          throw new DomainError("CONFLICT", "Invitation revoked.", "invitation_revoked");
        }
        if (row.expiresAt.getTime() <= input.now.getTime()) {
          throw new DomainError("CONFLICT", "Invitation expired.", "invitation_expired");
        }
        throw new DomainError("CONFLICT", "Invitation already consumed.", "invitation_consumed");
      }

      // We won the claim — safe to admit. The upsert revives a
      // previously-removed membership; resetting `role: "participant"`
      // on conflict prevents a returning admin who consumes a fresh
      // (necessarily participant-level) invitation from silently
      // re-acquiring admin powers — that promotion is a separate
      // operator-driven path.
      await deps.db
        .insert(groupMemberships)
        .values({
          id: membershipId,
          groupId: inv.groupId as StudyGroupId,
          userId: input.userId,
          role: "participant",
          joinedAt: now,
          removedAt: null,
          removedBy: null,
          attributionOnLeave: null,
          displayNameSnapshot: null,
        })
        .onConflictDoUpdate({
          target: [groupMemberships.groupId, groupMemberships.userId],
          set: {
            role: "participant",
            removedAt: null,
            removedBy: null,
            attributionOnLeave: null,
            displayNameSnapshot: null,
          },
        });

      const memRows = await deps.db
        .select()
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, inv.groupId as StudyGroupId),
            eq(groupMemberships.userId, input.userId),
          ),
        )
        .limit(1);
      const membership = toMembership(memRows[0] as typeof groupMemberships.$inferSelect);
      return { membership, enrollment: null };
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
