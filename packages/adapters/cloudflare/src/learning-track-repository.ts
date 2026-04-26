import { trackEnrollments, tracks } from "@hearth/db/schema";
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
import { and, asc, eq, exists, isNull, ne, sql } from "drizzle-orm";
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
    throw new Error(`Track ${trackId} has unparseable structure JSON: ${(err as Error).message}`);
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
      `Track ${trackId} has unparseable contribution-policy JSON: ${(err as Error).message}`,
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

    async endAllEnrollmentsForUser({ groupId, userId, by }) {
      await deps.gate.assertWritable();
      const now = new Date();

      // Single guarded UPDATE: end every active enrollment this user holds
      // on tracks belonging to this group. The `exists` subquery confines
      // the update to enrollments whose parent track lives in the named
      // group — without it we would end enrollments cross-group.
      // TODO(M5): when facilitator assign/remove ships, this cascade may
      // strand a track with zero facilitators. M5's removal flow needs to
      // refuse the membership removal if it would leave any track in the
      // group with zero active facilitators (and the actor isn't promoting
      // a replacement first).
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
  };
}
