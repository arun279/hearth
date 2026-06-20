import { activityRecords, partHistory, partProgress } from "@hearth/db/schema";
import {
  type ActivityPartId,
  type ActivityRecord,
  type ActivityRecordId,
  type CompletionState,
  DomainError,
  initialPartProgressStateForKind,
  type LearningActivityId,
  type LibraryRevisionId,
  type PartHistory,
  type PartHistoryReason,
  type PartProgress,
  type PartProgressState,
  partHistoryEnvelopeSchema,
  partProgressEnvelopeSchema,
  type UserId,
  type VisibilityPreference,
  visibilityOverrideEnvelopeSchema,
} from "@hearth/domain";
import { type ActivityRecordRepository, markWrite } from "@hearth/ports";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { createIdGenerator } from "./id-generator.ts";

const DEFAULT_PAGE_LIMIT = 100;

/**
 * D1 implementation of the full M11 `ActivityRecordRepository`.
 *
 * - `upsert` is an idempotent get-or-create on the UNIQUE
 *   (activityId, participantId) index: INSERT … ON CONFLICT DO NOTHING,
 *   then read the canonical row back. A concurrent first-touch from the
 *   same participant collapses to one row.
 * - `savePartProgress` UPSERTs the (record, part) row and touches the
 *   parent record's `updatedAt`. The stored `stateJson` is the versioned
 *   envelope, parsed through the same Zod schema on read so a malformed
 *   row surfaces as `INVARIANT_VIOLATION` rather than rendering a malformed value.
 * - `setPartCompletion` flips ONLY the `completed` flag via SQLite
 *   `json_set` on the existing `state_json`, so an in-flight reflection
 *   autosave is never clobbered by a stale client envelope (no
 *   read-modify-write of the whole envelope).
 * - `reopenAgainstRevision` archives the affected Parts' current progress
 *   into `part_history` and resets it to the kind-appropriate initial
 *   state, all in ONE D1 batch. Idempotent per (record, newRevisionId):
 *   a Part whose latest history already names `newRevisionId` is skipped.
 * - `flushEvidenceSignals` is gate-branded and a no-op in M11; the
 *   throttled, write-budget-limited batcher that performs the real D1
 *   write ships in M17 (see the note at the method).
 *
 * Resilience invariants 2 + 3: every mutation calls `gate.assertWritable()`
 * first and is wrapped in `markWrite()` so it appears in the
 * killswitch-coverage CASES.
 */
export function createActivityRecordRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): ActivityRecordRepository {
  const ids = createIdGenerator();

  const loadById = async (id: ActivityRecordId): Promise<ActivityRecord | null> => {
    const rows = await deps.db
      .select()
      .from(activityRecords)
      .where(eq(activityRecords.id, id))
      .limit(1);
    const row = rows[0];
    return row ? decodeRecord(row) : null;
  };

  const loadRecord = async (
    activityId: LearningActivityId,
    participantId: UserId,
  ): Promise<ActivityRecord | null> => {
    const rows = await deps.db
      .select()
      .from(activityRecords)
      .where(
        and(
          eq(activityRecords.activityId, activityId),
          eq(activityRecords.participantId, participantId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? decodeRecord(row) : null;
  };

  return {
    upsert: markWrite(async ({ activityId, participantId }) => {
      await deps.gate.assertWritable();
      const now = new Date();
      await deps.db
        .insert(activityRecords)
        .values({
          id: ids.generate(),
          activityId,
          participantId,
          completionState: "in_progress",
          completedAt: null,
          visibilityOverrideJson: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [activityRecords.activityId, activityRecords.participantId],
        });
      const row = await loadRecord(activityId, participantId);
      if (!row) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          "Activity record upsert produced no row.",
          "record_upsert_failed",
        );
      }
      return row;
    }),

    byId(id) {
      return loadById(id);
    },

    byParticipantAndActivity(activityId, participantId) {
      return loadRecord(activityId, participantId);
    },

    async listByActivity(activityId, opts) {
      const limit = opts?.limit ?? DEFAULT_PAGE_LIMIT;
      const after = opts?.cursor;
      // Keyset pagination on the primary key — stable total order, no
      // OFFSET scan. The cursor is the last id of the prior page.
      const rows = await deps.db
        .select()
        .from(activityRecords)
        .where(
          after
            ? and(eq(activityRecords.activityId, activityId), gt(activityRecords.id, after))
            : eq(activityRecords.activityId, activityId),
        )
        .orderBy(asc(activityRecords.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
      return { records: page.map(decodeRecord), nextCursor };
    },

    async listByParticipant(userId, opts) {
      const limit = opts?.limit ?? DEFAULT_PAGE_LIMIT;
      const rows = await deps.db
        .select()
        .from(activityRecords)
        .where(eq(activityRecords.participantId, userId))
        .orderBy(opts?.recent ? desc(activityRecords.updatedAt) : asc(activityRecords.id))
        .limit(limit);
      return rows.map(decodeRecord);
    },

    setCompletion: markWrite(async ({ id, state, at }) => {
      await deps.gate.assertWritable();
      const completedAt = state === "completed" ? at : null;
      const updated = await deps.db
        .update(activityRecords)
        .set({ completionState: state, completedAt, updatedAt: at })
        .where(eq(activityRecords.id, id))
        .returning({ id: activityRecords.id });
      if (updated.length === 0) {
        throw new DomainError("NOT_FOUND", "Activity record not found.", "not_found");
      }
    }),

    setVisibilityOverride: markWrite(async (id, override) => {
      await deps.gate.assertWritable();
      const now = new Date();
      const json =
        override === null
          ? null
          : JSON.stringify(
              visibilityOverrideEnvelopeSchema.parse({ v: 1, data: { preference: override } }),
            );
      const updated = await deps.db
        .update(activityRecords)
        .set({ visibilityOverrideJson: json, updatedAt: now })
        .where(eq(activityRecords.id, id))
        .returning({ id: activityRecords.id });
      if (updated.length === 0) {
        throw new DomainError("NOT_FOUND", "Activity record not found.", "not_found");
      }
    }),

    async getPartProgress({ activityRecordId, partId }) {
      const rows = await deps.db
        .select()
        .from(partProgress)
        .where(
          and(eq(partProgress.activityRecordId, activityRecordId), eq(partProgress.partId, partId)),
        )
        .limit(1);
      const row = rows[0];
      return row ? decodePartProgress(row) : null;
    },

    async listPartProgress(activityRecordId) {
      const rows = await deps.db
        .select()
        .from(partProgress)
        .where(eq(partProgress.activityRecordId, activityRecordId));
      return rows.map(decodePartProgress);
    },

    savePartProgress: markWrite(async ({ activityRecordId, partId, state }) => {
      await deps.gate.assertWritable();
      const now = new Date();
      const stateJson = JSON.stringify(partProgressEnvelopeSchema.parse({ v: 1, data: state }));
      // Batch the child UPSERT and the parent updatedAt touch so the
      // (participantId, updatedAt) "recent records" ordering can never fall
      // behind the part_progress row it summarizes.
      await deps.db.batch(
        asBatch([
          deps.db
            .insert(partProgress)
            .values({ id: ids.generate(), activityRecordId, partId, stateJson, updatedAt: now })
            .onConflictDoUpdate({
              target: [partProgress.activityRecordId, partProgress.partId],
              set: { stateJson, updatedAt: now },
            }),
          deps.db
            .update(activityRecords)
            .set({ updatedAt: now })
            .where(eq(activityRecords.id, activityRecordId)),
        ]),
      );
    }),

    setPartCompletion: markWrite(async ({ activityRecordId, partId, completed, initialState }) => {
      await deps.gate.assertWritable();
      const now = new Date();
      // `json(?)` parses the literal so the flag lands as a JSON boolean, not
      // the integer json_set would store from a bound 1/0 — the envelope
      // schema validates `completed` as a boolean on read.
      const setCompletedJson = sql`json_set(${partProgress.stateJson}, '$.data.completed', json(${
        completed ? "true" : "false"
      }))`;
      // Targeted patch: flip only `$.data.completed` on whatever envelope is
      // currently persisted, so a concurrent in-flight reflection autosave
      // can never be clobbered by a stale client-supplied envelope. The
      // `.returning()` distinguishes "patched an existing row" from "no row
      // yet" without a prior read (which would reintroduce a race window).
      const patched = await deps.db
        .update(partProgress)
        .set({ stateJson: setCompletedJson, updatedAt: now })
        .where(
          and(eq(partProgress.activityRecordId, activityRecordId), eq(partProgress.partId, partId)),
        )
        .returning({ id: partProgress.id });

      if (patched.length === 0) {
        const stateJson = JSON.stringify(
          partProgressEnvelopeSchema.parse({ v: 1, data: { ...initialState, completed } }),
        );
        await deps.db
          .insert(partProgress)
          .values({ id: ids.generate(), activityRecordId, partId, stateJson, updatedAt: now })
          .onConflictDoUpdate({
            target: [partProgress.activityRecordId, partProgress.partId],
            set: { stateJson: setCompletedJson, updatedAt: now },
          });
      }
      await deps.db
        .update(activityRecords)
        .set({ updatedAt: now })
        .where(eq(activityRecords.id, activityRecordId));
    }),

    appendPartHistory: markWrite(
      async ({ activityRecordId, partId, snapshot, reason, ...rest }) => {
        await deps.gate.assertWritable();
        const now = new Date();
        const stateJson = encodeHistory(snapshot, reason, rest.revisionIdAtTime ?? null);
        await deps.db
          .insert(partHistory)
          .values({ id: ids.generate(), activityRecordId, partId, stateJson, recordedAt: now });
      },
    ),

    async listPartHistory(activityRecordId, opts) {
      const rows = await deps.db
        .select()
        .from(partHistory)
        .where(
          opts?.partId
            ? and(
                eq(partHistory.activityRecordId, activityRecordId),
                eq(partHistory.partId, opts.partId),
              )
            : eq(partHistory.activityRecordId, activityRecordId),
        )
        .orderBy(desc(partHistory.recordedAt));
      return rows.map(decodePartHistory);
    },

    async countPartHistory(activityRecordId) {
      const rows = await deps.db
        .select({ n: sql<number>`count(*)` })
        .from(partHistory)
        .where(eq(partHistory.activityRecordId, activityRecordId));
      return Number(rows[0]?.n ?? 0);
    },

    reopenAgainstRevision: markWrite(
      async ({ recordId, newRevisionId, affectedPartIds, reason }) => {
        await deps.gate.assertWritable();
        if (affectedPartIds.length === 0) return;
        const now = new Date();

        const partIds = [...affectedPartIds] as string[];
        const [current, latestHistory] = await Promise.all([
          deps.db
            .select()
            .from(partProgress)
            .where(
              and(
                eq(partProgress.activityRecordId, recordId),
                inArray(partProgress.partId, partIds),
              ),
            ),
          deps.db
            .select()
            .from(partHistory)
            .where(
              and(eq(partHistory.activityRecordId, recordId), inArray(partHistory.partId, partIds)),
            )
            .orderBy(desc(partHistory.recordedAt)),
        ]);

        // Idempotency: skip a Part whose most-recent history row already
        // names `newRevisionId` (a retried revision bump). `null`
        // newRevisionId (facilitator_reset) is never deduped — a reset is
        // always intentional and may repeat.
        const latestRevisionByPart = new Map<string, string | null>();
        for (const h of latestHistory) {
          if (!latestRevisionByPart.has(h.partId)) {
            latestRevisionByPart.set(h.partId, decodePartHistory(h).revisionIdAtTime);
          }
        }
        const progressByPart = new Map(current.map((p) => [p.partId, p]));

        const statements = [];
        for (const partId of affectedPartIds) {
          if (
            newRevisionId !== null &&
            latestRevisionByPart.get(partId as string) === newRevisionId
          ) {
            continue;
          }
          const row = progressByPart.get(partId as string);
          if (!row) continue;
          const snapshot = decodePartProgress(row).state;
          statements.push(
            deps.db.insert(partHistory).values({
              id: ids.generate(),
              activityRecordId: recordId,
              partId,
              stateJson: encodeHistory(snapshot, reason, newRevisionId),
              recordedAt: now,
            }),
            deps.db
              .update(partProgress)
              .set({
                stateJson: JSON.stringify(
                  partProgressEnvelopeSchema.parse({
                    v: 1,
                    data: initialPartProgressStateForKind(snapshot.kind),
                  }),
                ),
                updatedAt: now,
              })
              .where(
                and(
                  eq(partProgress.activityRecordId, recordId),
                  eq(partProgress.partId, partId as string),
                ),
              ),
          );
        }
        if (statements.length === 0) return;
        statements.push(
          deps.db
            .update(activityRecords)
            .set({ updatedAt: now })
            .where(eq(activityRecords.id, recordId)),
        );
        await deps.db.batch(asBatch(statements));
      },
    ),

    // Evidence Signals: the enqueue CALLS land in M11 (saveReflectionDraft /
    // submitQuizAnswers invoke this on every autosave + submit), but the
    // actual D1 write is gated behind M17's throttled batcher + the
    // ≤ 50-write/user/day limiter. Writing per autosave here would breach
    // the write budget the $0 guarantee depends on, so M11 keeps the body a
    // no-op. The gate call stays for the killswitch-coverage invariant.
    flushEvidenceSignals: markWrite(async (_signals) => {
      await deps.gate.assertWritable();
    }),

    async listEvidenceSignals() {
      return [];
    },
  };
}

function encodeHistory(
  snapshot: PartProgressState,
  reason: PartHistoryReason,
  revisionIdAtTime: LibraryRevisionId | null,
): string {
  return JSON.stringify(
    partHistoryEnvelopeSchema.parse({ v: 1, snapshot, reason, revisionIdAtTime }),
  );
}

function decodeRecord(row: typeof activityRecords.$inferSelect): ActivityRecord {
  return {
    id: row.id as ActivityRecordId,
    activityId: row.activityId as LearningActivityId,
    participantId: row.participantId as UserId,
    completionState: row.completionState as CompletionState,
    completedAt: row.completedAt,
    visibilityOverride: parseVisibilityOverride(row.visibilityOverrideJson, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseVisibilityOverride(
  raw: string | null,
  recordId: string,
): VisibilityPreference | null {
  if (raw === null) return null;
  try {
    return visibilityOverrideEnvelopeSchema.parse(JSON.parse(raw)).data.preference;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Activity record ${recordId} has invalid visibilityOverrideJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

function decodePartProgress(row: typeof partProgress.$inferSelect): PartProgress {
  let state: PartProgressState;
  try {
    state = partProgressEnvelopeSchema.parse(JSON.parse(row.stateJson)).data;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Part progress ${row.id} has invalid stateJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
  return {
    id: row.id,
    activityRecordId: row.activityRecordId as ActivityRecordId,
    partId: row.partId as ActivityPartId,
    state,
    updatedAt: row.updatedAt,
  };
}

function decodePartHistory(row: typeof partHistory.$inferSelect): PartHistory {
  let envelope: ReturnType<typeof partHistoryEnvelopeSchema.parse>;
  try {
    envelope = partHistoryEnvelopeSchema.parse(JSON.parse(row.stateJson));
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Part history ${row.id} has invalid stateJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
  return {
    id: row.id,
    activityRecordId: row.activityRecordId as ActivityRecordId,
    partId: row.partId as ActivityPartId,
    snapshot: envelope.snapshot,
    reason: envelope.reason,
    revisionIdAtTime: envelope.revisionIdAtTime as LibraryRevisionId | null,
    recordedAt: row.recordedAt,
  };
}

type BatchStatements = Parameters<CloudflareAdapterDeps["db"]["batch"]>[0];

function asBatch(statements: readonly unknown[]): BatchStatements {
  return statements as unknown as BatchStatements;
}
