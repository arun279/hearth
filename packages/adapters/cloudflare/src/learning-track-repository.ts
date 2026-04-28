import { groupMemberships, trackEnrollments, tracks } from "@hearth/db/schema";
import {
  type ContributionMode,
  type ContributionPolicyEnvelope,
  DEFAULT_CONTRIBUTION_POLICY,
  DomainError,
  EMPTY_TRACK_STRUCTURE,
  type LearningTrack,
  type LearningTrackId,
  type StudyGroupId,
  type TrackEnrollment,
  type TrackRole,
  type TrackStatus,
  type TrackStructureEnvelope,
  type UserId,
} from "@hearth/domain";
import type { LearningTrackRepository } from "@hearth/ports";
import { and, asc, eq, exists, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { createIdGenerator } from "./id-generator.ts";

function toTrack(r: typeof tracks.$inferSelect): LearningTrack {
  return {
    id: r.id as LearningTrackId,
    groupId: r.groupId as StudyGroupId,
    name: r.name,
    description: r.description,
    status: r.status as TrackStatus,
    pausedAt: r.pausedAt,
    archivedAt: r.archivedAt,
    archivedBy: r.archivedBy === null ? null : (r.archivedBy as UserId),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toEnrollment(r: typeof trackEnrollments.$inferSelect): TrackEnrollment {
  return {
    trackId: r.trackId as LearningTrackId,
    userId: r.userId as UserId,
    role: r.role as TrackRole,
    enrolledAt: r.enrolledAt,
    leftAt: r.leftAt,
  };
}

const CONTRIBUTION_MODES: readonly ContributionMode[] = [
  "direct",
  "optional_review",
  "required_review",
  "none",
];

function isContributionMode(value: unknown): value is ContributionMode {
  return typeof value === "string" && (CONTRIBUTION_MODES as readonly string[]).includes(value);
}

/**
 * Manual structural validation for the persisted JSON envelopes. The
 * adapter is the only layer that touches raw JSON, and it sits outside the
 * core/zod boundary by design — so we hand-roll the parse here. Each
 * branch throws a tagged Error that surfaces as a 500 with the failure
 * reason in logs, never as a silent type cast that would let drift land
 * downstream.
 */
function parseStructureEnvelope(raw: string, trackId: string): TrackStructureEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Track ${trackId} has unparsable structure JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Track ${trackId} structure envelope is not an object.`);
  }
  const env = parsed as { v?: unknown; data?: unknown };
  if (env.v !== 1) {
    // Adding a v: 2 will require a read-time shim here that lifts the old
    // shape into the new one. Throw loudly so the missing shim is impossible
    // to ignore.
    throw new Error(`Track ${trackId} structure envelope has unknown version ${String(env.v)}.`);
  }
  const data = env.data as { mode?: unknown; sections?: unknown };
  if (!data || typeof data !== "object") {
    throw new Error(`Track ${trackId} structure envelope is missing data.`);
  }
  if (data.mode === "free") {
    return { v: 1, data: { mode: "free" } };
  }
  if (data.mode === "ordered_sections") {
    if (!Array.isArray(data.sections)) {
      throw new Error(`Track ${trackId} ordered_sections envelope missing sections array.`);
    }
    const sections = data.sections.map(
      (
        section,
        idx,
      ): TrackStructureEnvelope["data"] extends {
        sections: infer S;
      }
        ? S extends ReadonlyArray<infer One>
          ? One
          : never
        : never => {
        if (!section || typeof section !== "object") {
          throw new Error(
            `Track ${trackId} ordered_sections envelope has non-object section at index ${idx}.`,
          );
        }
        const s = section as { id?: unknown; title?: unknown; activityIds?: unknown };
        if (typeof s.id !== "string" || typeof s.title !== "string") {
          throw new Error(
            `Track ${trackId} ordered_sections envelope has malformed section at index ${idx}.`,
          );
        }
        if (
          !Array.isArray(s.activityIds) ||
          !s.activityIds.every((id): id is string => typeof id === "string")
        ) {
          throw new Error(
            `Track ${trackId} ordered_sections section ${s.id} has non-string activityIds.`,
          );
        }
        return {
          id: s.id,
          title: s.title,
          activityIds: s.activityIds as readonly string[],
        } as never;
      },
    );
    return { v: 1, data: { mode: "ordered_sections", sections } };
  }
  throw new Error(`Track ${trackId} structure envelope has unknown mode ${String(data.mode)}.`);
}

function parseContributionPolicyEnvelope(raw: string, trackId: string): ContributionPolicyEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Track ${trackId} has unparsable contribution-policy JSON: ${(err as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Track ${trackId} contribution-policy envelope is not an object.`);
  }
  const env = parsed as { v?: unknown; data?: unknown };
  if (env.v !== 1) {
    throw new Error(
      `Track ${trackId} contribution-policy envelope has unknown version ${String(env.v)}.`,
    );
  }
  const data = env.data as { mode?: unknown };
  if (!data || typeof data !== "object" || !isContributionMode(data.mode)) {
    throw new Error(
      `Track ${trackId} contribution-policy envelope has invalid mode ${String(
        (data as { mode?: unknown } | null)?.mode,
      )}.`,
    );
  }
  return { v: 1, data: { mode: data.mode } };
}

/**
 * Conditional UPDATE that writes one JSON column on a non-archived track,
 * returning the resulting row. Shared by `saveStructure` and
 * `saveContributionPolicy` because they have identical safety shape:
 * gate first, set the column + `updatedAt`, guard on `status != 'archived'`
 * via `.returning()`, and translate a zero-row result into NOT_FOUND or
 * CONFLICT depending on whether the row exists at all.
 *
 * Generic over the column name so the typed `set({ ... })` call site stays
 * inferable without any drizzle-side dynamic-property gymnastics.
 */
async function saveTrackJsonColumn(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
  id: LearningTrackId,
  opts: {
    readonly column: "trackStructureJson" | "contributionPolicyJson";
    readonly value: string;
    readonly archivedDetail: string;
  },
): Promise<LearningTrack> {
  await deps.gate.assertWritable();
  const now = new Date();
  const patch =
    opts.column === "trackStructureJson"
      ? { trackStructureJson: opts.value, updatedAt: now }
      : { contributionPolicyJson: opts.value, updatedAt: now };
  const updated = await deps.db
    .update(tracks)
    .set(patch)
    .where(and(eq(tracks.id, id), ne(tracks.status, "archived")))
    .returning();
  if (updated.length === 0) {
    const after = await deps.db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!after[0]) {
      throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
    }
    throw new DomainError("CONFLICT", opts.archivedDetail, "track_archived");
  }
  return toTrack(updated[0] as typeof tracks.$inferSelect);
}

/**
 * Build the SQL `EXISTS` expression for "the user holds a current group
 * membership on the track's parent group." Pulled to a helper so the
 * `enroll` UPSERT and the post-write membership re-check share one
 * shape.
 */
function membershipExistsExpr(
  db: Pick<CloudflareAdapterDeps, "db">["db"],
  trackId: LearningTrackId,
  userId: UserId,
) {
  return exists(
    db
      .select({ n: sql<number>`1` })
      .from(groupMemberships)
      .innerJoin(tracks, eq(tracks.groupId, groupMemberships.groupId))
      .where(
        and(
          eq(tracks.id, trackId),
          eq(groupMemberships.userId, userId),
          isNull(groupMemberships.removedAt),
        ),
      ),
  );
}

/**
 * Throw `enrollment_requires_membership` if the user has no current group
 * membership on the track's parent group. Shared between the two
 * post-write paths in `enroll` so the deny code stays consistent.
 */
async function assertMembershipExists(
  db: Pick<CloudflareAdapterDeps, "db">["db"],
  trackId: LearningTrackId,
  userId: UserId,
): Promise<void> {
  const memRows = await db
    .select({ n: sql<number>`1` })
    .from(groupMemberships)
    .innerJoin(tracks, eq(tracks.groupId, groupMemberships.groupId))
    .where(
      and(
        eq(tracks.id, trackId),
        eq(groupMemberships.userId, userId),
        isNull(groupMemberships.removedAt),
      ),
    )
    .limit(1);
  if (memRows.length === 0) {
    throw new DomainError(
      "FORBIDDEN",
      "Group Membership is required before enrolling in a Learning Track.",
      "enrollment_requires_membership",
    );
  }
}

/**
 * Build the WHERE-clause fragment that protects the orphan-facilitator
 * invariant for both `unenroll` (sets leftAt) and `setEnrollmentRole →
 * participant` (demote). The guard passes IF the target is a
 * participant, OR the track is not active, OR there is at least one
 * OTHER active facilitator. Mirrors `wouldOrphanFacilitator` in domain.
 */
function orphanGuard(
  db: Pick<CloudflareAdapterDeps, "db">["db"],
  trackId: LearningTrackId,
  userId: UserId,
) {
  const otherFacilitators = db
    .select({ n: sql<number>`count(*)` })
    .from(trackEnrollments)
    .where(
      and(
        eq(trackEnrollments.trackId, trackId),
        eq(trackEnrollments.role, "facilitator"),
        isNull(trackEnrollments.leftAt),
        ne(trackEnrollments.userId, userId),
      ),
    );
  const trackIsActive = exists(
    db
      .select({ n: sql<number>`1` })
      .from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.status, "active"))),
  );
  return or(
    ne(trackEnrollments.role, "facilitator"),
    sql`NOT (${trackIsActive})`,
    sql`(${otherFacilitators}) >= 1`,
  );
}

/**
 * Re-read the (trackId, userId) enrollment row after a guarded UPDATE
 * touched zero rows — used to disambiguate the failure cause for both
 * `unenroll` and the demote branch of `setEnrollmentRole`. Returns the
 * row for the caller to inspect; both cases share the same disambiguator.
 */
async function reReadEnrollment(
  db: Pick<CloudflareAdapterDeps, "db">["db"],
  trackId: LearningTrackId,
  userId: UserId,
): Promise<typeof trackEnrollments.$inferSelect | undefined> {
  const after = await db
    .select()
    .from(trackEnrollments)
    .where(and(eq(trackEnrollments.trackId, trackId), eq(trackEnrollments.userId, userId)))
    .limit(1);
  return after[0];
}

/**
 * Real D1 implementation of `LearningTrackRepository`. Mirrors the
 * resilience disciplines from `createStudyGroupRepository`:
 *
 * - Every mutation calls `gate.assertWritable()` first (resilience
 *   invariant 2 — `killswitch-coverage.test.ts` enforces).
 * - `create` inserts the track row + the creator's first facilitator
 *   enrollment in one D1 batch so the "active track has ≥ 1 facilitator"
 *   invariant holds at row 0.
 * - `updateStatus` is a single conditional UPDATE with the prior status in
 *   the WHERE clause + `.returning()`; concurrent flips race safely and
 *   the loser receives CONFLICT `track_status_changed`.
 * - `updateMetadata` / `saveStructure` / `saveContributionPolicy` use the
 *   same conditional-UPDATE pattern guarded on `status != 'archived'` so a
 *   write cannot land on a now-archived row.
 * - `endAllEnrollmentsForUser` is a single guarded UPDATE so the cascade
 *   from membership removal cannot end an already-left enrollment twice.
 *
 * JSON envelopes are validated manually on read (defense in depth) — the
 * adapter sits outside the core/zod boundary, so a hand-rolled parser here
 * keeps the dependency surface minimal.
 */
export function createLearningTrackRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): LearningTrackRepository {
  const ids = createIdGenerator();

  return {
    async create({
      groupId,
      name,
      description,
      createdBy,
      structure = EMPTY_TRACK_STRUCTURE,
      contributionPolicy = DEFAULT_CONTRIBUTION_POLICY,
    }) {
      await deps.gate.assertWritable();
      const id = ids.generate() as LearningTrackId;
      const enrollmentId = ids.generate();
      const now = new Date();

      // Single D1 batch — both statements commit atomically. SQLite reports
      // the entire batch as one transaction; partial application is not
      // possible. The "≥ 1 facilitator" invariant is satisfied at row 0.
      await deps.db.batch([
        deps.db.insert(tracks).values({
          id,
          groupId,
          name,
          description,
          status: "active",
          trackStructureJson: JSON.stringify(structure),
          contributionPolicyJson: JSON.stringify(contributionPolicy),
          pausedAt: null,
          archivedAt: null,
          archivedBy: null,
          createdAt: now,
          updatedAt: now,
        }),
        deps.db.insert(trackEnrollments).values({
          id: enrollmentId,
          trackId: id,
          userId: createdBy,
          role: "facilitator",
          enrolledAt: now,
          leftAt: null,
          leftBy: null,
        }),
      ]);

      return {
        id,
        groupId,
        name,
        description,
        status: "active",
        pausedAt: null,
        archivedAt: null,
        archivedBy: null,
        createdAt: now,
        updatedAt: now,
      };
    },

    async byId(id) {
      const rows = await deps.db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
      return rows[0] ? toTrack(rows[0]) : null;
    },

    async byGroup(groupId, opts) {
      const baseQuery = deps.db.select().from(tracks);
      const rows = opts?.status
        ? await baseQuery
            .where(and(eq(tracks.groupId, groupId), eq(tracks.status, opts.status)))
            .orderBy(asc(tracks.createdAt))
        : await baseQuery.where(eq(tracks.groupId, groupId)).orderBy(asc(tracks.createdAt));
      return rows.map(toTrack);
    },

    async updateStatus({ id, to, expectedFromStatus, by }) {
      await deps.gate.assertWritable();
      const now = new Date();

      // Build the patch: pausedAt is the most recent pause timestamp,
      // cleared on resume to active. archivedAt/By are set on archive and
      // never cleared (terminal). pausedAt is left as-is on archive so the
      // audit trail keeps the "was paused before archive" history.
      const patch =
        to === "paused"
          ? { status: to, pausedAt: now, updatedAt: now }
          : to === "archived"
            ? { status: to, archivedAt: now, archivedBy: by, updatedAt: now }
            : { status: to, pausedAt: null, archivedAt: null, archivedBy: null, updatedAt: now };

      // Conditional UPDATE: only succeed if the row is still at the
      // caller's snapshot status. A concurrent flip races safely — the
      // WHERE clause filters and the loser receives CONFLICT below.
      const updated = await deps.db
        .update(tracks)
        .set(patch)
        .where(and(eq(tracks.id, id), eq(tracks.status, expectedFromStatus)))
        .returning();

      if (updated.length === 0) {
        // Re-read so the caller sees the freshest status, not a stale
        // CONFLICT message that would mislead the next retry.
        const after = await deps.db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
        if (!after[0]) {
          throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
        }
        throw new DomainError(
          "CONFLICT",
          `Track is currently ${after[0].status}; expected ${expectedFromStatus}.`,
          "track_status_changed",
        );
      }

      return toTrack(updated[0] as typeof tracks.$inferSelect);
    },

    async updateMetadata(id, patch, _by) {
      await deps.gate.assertWritable();
      const existing = await deps.db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
      const row = existing[0];
      if (!row) {
        throw new DomainError("NOT_FOUND", "Track not found.", "not_found");
      }
      if (row.status === "archived") {
        throw new DomainError(
          "CONFLICT",
          "Archived tracks do not allow metadata edits.",
          "track_archived",
        );
      }
      const now = new Date();
      const next = {
        name: patch.name ?? row.name,
        description: patch.description === undefined ? row.description : patch.description,
        updatedAt: now,
      };
      const updated = await deps.db
        .update(tracks)
        .set(next)
        .where(and(eq(tracks.id, id), ne(tracks.status, "archived")))
        .returning();
      if (updated.length === 0) {
        // SELECT-then-UPDATE race: a concurrent archive landed between our
        // read and the UPDATE. Surface as CONFLICT so the SPA can refetch.
        throw new DomainError(
          "CONFLICT",
          "Archived tracks do not allow metadata edits.",
          "track_archived",
        );
      }
      return toTrack(updated[0] as typeof tracks.$inferSelect);
    },

    async saveStructure(id, envelope, _by) {
      // Defense in depth: re-parse before persisting so a caller bypassing
      // the use case still cannot persist a malformed envelope.
      const validated = parseStructureEnvelope(JSON.stringify(envelope), id);
      return saveTrackJsonColumn(deps, id, {
        column: "trackStructureJson",
        value: JSON.stringify(validated),
        archivedDetail: "Archived tracks do not allow structure edits.",
      });
    },

    async saveContributionPolicy(id, envelope, _by) {
      const validated = parseContributionPolicyEnvelope(JSON.stringify(envelope), id);
      return saveTrackJsonColumn(deps, id, {
        column: "contributionPolicyJson",
        value: JSON.stringify(validated),
        archivedDetail: "Archived tracks do not allow contribution-policy changes.",
      });
    },

    async loadStructure(id) {
      const rows = await deps.db
        .select({ json: tracks.trackStructureJson })
        .from(tracks)
        .where(eq(tracks.id, id))
        .limit(1);
      if (!rows[0]) return null;
      return parseStructureEnvelope(rows[0].json, id);
    },

    async loadContributionPolicy(id) {
      const rows = await deps.db
        .select({ json: tracks.contributionPolicyJson })
        .from(tracks)
        .where(eq(tracks.id, id))
        .limit(1);
      if (!rows[0]) return null;
      return parseContributionPolicyEnvelope(rows[0].json, id);
    },

    // ── Enrollment surface ────────────────────────────────────────────────

    async enrollment(trackId, userId) {
      const rows = await deps.db
        .select()
        .from(trackEnrollments)
        .where(and(eq(trackEnrollments.trackId, trackId), eq(trackEnrollments.userId, userId)))
        .limit(1);
      return rows[0] ? toEnrollment(rows[0]) : null;
    },

    async listFacilitators(trackId) {
      const rows = await deps.db
        .select()
        .from(trackEnrollments)
        .where(
          and(
            eq(trackEnrollments.trackId, trackId),
            eq(trackEnrollments.role, "facilitator"),
            isNull(trackEnrollments.leftAt),
          ),
        )
        .orderBy(asc(trackEnrollments.enrolledAt));
      return rows.map(toEnrollment);
    },

    async countFacilitators(trackId) {
      const rows = await deps.db
        .select({ n: sql<number>`count(*)` })
        .from(trackEnrollments)
        .where(
          and(
            eq(trackEnrollments.trackId, trackId),
            eq(trackEnrollments.role, "facilitator"),
            isNull(trackEnrollments.leftAt),
          ),
        );
      return Number(rows[0]?.n ?? 0);
    },

    async countEnrollments(trackId) {
      const rows = await deps.db
        .select({ n: sql<number>`count(*)` })
        .from(trackEnrollments)
        .where(and(eq(trackEnrollments.trackId, trackId), isNull(trackEnrollments.leftAt)));
      return Number(rows[0]?.n ?? 0);
    },

    async enrollmentsForUser(userId) {
      const rows = await deps.db
        .select()
        .from(trackEnrollments)
        .where(and(eq(trackEnrollments.userId, userId), isNull(trackEnrollments.leftAt)))
        .orderBy(asc(trackEnrollments.enrolledAt));
      return rows.map(toEnrollment);
    },

    async listEnrollments(trackId, opts) {
      const baseQuery = deps.db.select().from(trackEnrollments);
      const rows = opts.includeLeft
        ? await baseQuery
            .where(eq(trackEnrollments.trackId, trackId))
            .orderBy(asc(trackEnrollments.enrolledAt))
        : await baseQuery
            .where(and(eq(trackEnrollments.trackId, trackId), isNull(trackEnrollments.leftAt)))
            .orderBy(asc(trackEnrollments.enrolledAt));
      return rows.map(toEnrollment);
    },

    async enroll({ trackId, userId, by }) {
      await deps.gate.assertWritable();
      const now = new Date();
      const generatedId = ids.generate();

      // Membership must exist + be current at write time. Single conditional
      // UPSERT: insert OR (on the existing soft-left row) clear leftAt /
      // leftBy + reset enrolledAt. Branching by SELECT is unsafe under
      // concurrency — we route both paths through one statement.
      //
      // The `where` on the upsert SET branch keeps us from clobbering an
      // already-active row's role/enrolledAt — for a no-op revival we only
      // touch the soft-left case. Active rows return through the post-write
      // SELECT below as the existing row.
      const membershipExists = membershipExistsExpr(deps.db, trackId, userId);

      // Phase 1: idempotent revive — clear leftAt on a soft-left row.
      // SQLite UPSERT can't gate the conflict-set on row state, so we run
      // a guarded UPDATE first to handle the revive case explicitly.
      await deps.db
        .update(trackEnrollments)
        .set({ leftAt: null, leftBy: null, enrolledAt: now })
        .where(
          and(
            eq(trackEnrollments.trackId, trackId),
            eq(trackEnrollments.userId, userId),
            isNotNull(trackEnrollments.leftAt),
            membershipExists,
          ),
        );

      // Phase 2: insert when no row exists. The unique index on
      // (trackId, userId) means concurrent insert attempts serialize at
      // SQLite — a conflict here means someone else inserted between
      // phases, which we treat as a no-op (the post-read returns the
      // canonical row).
      await deps.db
        .insert(trackEnrollments)
        .values({
          id: generatedId,
          trackId,
          userId,
          role: "participant",
          enrolledAt: now,
          leftAt: null,
          leftBy: null,
        })
        .onConflictDoNothing({
          target: [trackEnrollments.trackId, trackEnrollments.userId],
        });

      // Post-read confirms the canonical row + enforces the membership
      // guard. If no row landed (insert/update both no-op'd), the cause
      // is missing membership — the only way both can fail.
      const rows = await deps.db
        .select()
        .from(trackEnrollments)
        .where(and(eq(trackEnrollments.trackId, trackId), eq(trackEnrollments.userId, userId)))
        .limit(1);

      const row = rows[0];
      if (!row) {
        // No row: phase 1 found nothing to revive, phase 2 didn't insert.
        // The phase-2 INSERT only no-ops on a conflict against an existing
        // row (which would have been observed by the SELECT) — a missing
        // membership is therefore the only remaining cause. We re-check
        // explicitly so the deny code reflects the real cause, not a guess.
        await assertMembershipExists(deps.db, trackId, userId);
        // Defense-in-depth: track was deleted concurrently or a partial
        // commit landed mid-batch. Both are vanishingly rare on D1; surface
        // loudly so an operator can investigate rather than silently retry.
        throw new DomainError("NOT_FOUND", "Enrollment row missing after upsert.", "not_found");
      }

      // Active row that pre-existed: re-validate the membership guard so
      // a phase-2 conflict doesn't slip past it.
      if (row.leftAt === null) {
        await assertMembershipExists(deps.db, trackId, userId);
      }

      void by;
      return toEnrollment(row as typeof trackEnrollments.$inferSelect);
    },

    async unenroll({ trackId, userId, by }) {
      await deps.gate.assertWritable();
      const now = new Date();

      // Conditional UPDATE with the orphan invariant baked into the WHERE
      // clause. A demote/leave race cannot drop the active facilitator
      // count below 1 because both racers see the same view at statement
      // time and one of them filters out. Mirrors the canonical
      // `wouldOrphanFacilitator` predicate.
      const updated = await deps.db
        .update(trackEnrollments)
        .set({ leftAt: now, leftBy: by })
        .where(
          and(
            eq(trackEnrollments.trackId, trackId),
            eq(trackEnrollments.userId, userId),
            isNull(trackEnrollments.leftAt),
            orphanGuard(deps.db, trackId, userId),
          ),
        )
        .returning();

      if (updated[0]) {
        return toEnrollment(updated[0] as typeof trackEnrollments.$inferSelect);
      }

      // Re-read to disambiguate cause: row missing / already-left / orphan.
      const row = await reReadEnrollment(deps.db, trackId, userId);
      if (!row) {
        throw new DomainError("NOT_FOUND", "Enrollment not found.", "not_track_enrollee");
      }
      if (row.leftAt !== null) {
        // Idempotent no-op: the caller wanted to leave; the row already is.
        return toEnrollment(row);
      }
      // Row is still active — the orphan guard fired.
      throw new DomainError(
        "CONFLICT",
        "Cannot remove the last facilitator from an active track.",
        "would_orphan_facilitator",
      );
    },

    async setEnrollmentRole({ trackId, userId, role, by }) {
      await deps.gate.assertWritable();

      if (role === "facilitator") {
        // Promotion: target must hold a current enrollment. Single
        // conditional UPDATE — concurrent leave races cannot land a
        // promotion on a now-left row.
        const updated = await deps.db
          .update(trackEnrollments)
          .set({ role: "facilitator" })
          .where(
            and(
              eq(trackEnrollments.trackId, trackId),
              eq(trackEnrollments.userId, userId),
              isNull(trackEnrollments.leftAt),
            ),
          )
          .returning();

        if (updated[0]) {
          return toEnrollment(updated[0] as typeof trackEnrollments.$inferSelect);
        }
        // Disambiguate: row missing / left / already facilitator (no-op).
        const row = await reReadEnrollment(deps.db, trackId, userId);
        if (!row || row.leftAt !== null) {
          throw new DomainError(
            "FORBIDDEN",
            "Target must already have a current Track Enrollment before being promoted to facilitator.",
            "not_track_enrollee",
          );
        }
        // Already facilitator: no-op.
        return toEnrollment(row);
      }

      // Demotion: same orphan guard as unenroll, but the row stays
      // present (role flips to participant rather than leftAt landing).
      // Both call sites share the same predicate via `orphanGuard`.
      const updated = await deps.db
        .update(trackEnrollments)
        .set({ role: "participant" })
        .where(
          and(
            eq(trackEnrollments.trackId, trackId),
            eq(trackEnrollments.userId, userId),
            isNull(trackEnrollments.leftAt),
            orphanGuard(deps.db, trackId, userId),
          ),
        )
        .returning();

      if (updated[0]) {
        void by;
        return toEnrollment(updated[0] as typeof trackEnrollments.$inferSelect);
      }
      // Disambiguate: missing / left / orphan-block.
      const row = await reReadEnrollment(deps.db, trackId, userId);
      if (!row) {
        throw new DomainError("NOT_FOUND", "Enrollment not found.", "not_track_enrollee");
      }
      if (row.leftAt !== null) {
        throw new DomainError("FORBIDDEN", "Enrollment has already ended.", "not_track_enrollee");
      }
      throw new DomainError(
        "CONFLICT",
        "Cannot demote the last facilitator on an active track.",
        "would_orphan_facilitator",
      );
    },

    async endAllEnrollmentsForUser({ groupId, userId, by }) {
      await deps.gate.assertWritable();
      const now = new Date();

      // Single guarded UPDATE: end every active enrollment this user holds
      // on tracks belonging to this group. The `exists` subquery confines
      // the update to enrollments whose parent track lives in the named
      // group — without it we would end enrollments cross-group.
      //
      // The orphan-facilitator refusal that prevents this cascade from
      // silently stranding tracks lives upstream in the use case
      // (`removeGroupMember` / `leaveGroup` call
      // `findTracksOrphanedByMemberRemoval` first); by the time we get
      // here, the policy layer has confirmed the cascade is safe.
      const updated = await deps.db
        .update(trackEnrollments)
        .set({ leftAt: now, leftBy: by })
        .where(
          and(
            eq(trackEnrollments.userId, userId),
            isNull(trackEnrollments.leftAt),
            exists(
              deps.db
                .select({ n: sql<number>`1` })
                .from(tracks)
                .where(and(eq(tracks.id, trackEnrollments.trackId), eq(tracks.groupId, groupId))),
            ),
          ),
        )
        .returning({ id: trackEnrollments.id });

      return updated.length;
    },

    async findTracksOrphanedByMemberRemoval({ groupId, userId }) {
      // For each active track in the group where this user is currently
      // a facilitator: count OTHER active facilitators. If zero, the
      // cascade would orphan that track — surface it.
      //
      // Single SQL pass, indexed on (groupId, status) for tracks and
      // (trackId, role) for enrollments. The result is bounded by the
      // user's facilitator count, which in v1 stays single digits.
      const rows = await deps.db
        .select({
          trackId: tracks.id,
          trackName: tracks.name,
          otherFacilitators: sql<number>`(
            SELECT COUNT(*) FROM ${trackEnrollments} other
            WHERE other.track_id = ${tracks.id}
              AND other.role = 'facilitator'
              AND other.left_at IS NULL
              AND other.user_id <> ${userId}
          )`,
        })
        .from(tracks)
        .innerJoin(
          trackEnrollments,
          and(
            eq(trackEnrollments.trackId, tracks.id),
            eq(trackEnrollments.userId, userId),
            eq(trackEnrollments.role, "facilitator"),
            isNull(trackEnrollments.leftAt),
          ),
        )
        .where(and(eq(tracks.groupId, groupId), eq(tracks.status, "active")));

      return rows
        .filter((r) => Number(r.otherFacilitators) === 0)
        .map((r) => ({
          trackId: r.trackId as LearningTrackId,
          trackName: r.trackName,
        }));
    },
  };
}
