import { activityRecords, partHistory, partProgress } from "@hearth/db/schema";
import {
  type ActivityPartId,
  type ActivityRecord,
  type ActivityRecordId,
  type CompletionState,
  DomainError,
  type LearningActivityId,
  type LibraryRevisionId,
  type PartHistory,
  type PartHistoryReason,
  type PartProgress,
  type PartProgressState,
  partProgressStateEnvelopeSchema,
  type UserId,
} from "@hearth/domain";
import {
  type VisibilityPreference,
  visibilityOverrideEnvelopeSchema,
} from "@hearth/domain/visibility";
import { type ActivityRecordRepository, markWrite } from "@hearth/ports";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { createIdGenerator } from "./id-generator.ts";

type Statements = Parameters<CloudflareAdapterDeps["db"]["batch"]>[0];

/**
 * D1 implementation of `ActivityRecordRepository` — records, part progress,
 * and part history. Resilience invariant 2 (every mutation calls
 * `gate.assertWritable()` first) is enforced by `markWrite()` on each write.
 *
 * `reopenAgainstRevision` is the load-bearing method: it preserves-then-resets
 * the affected Parts in one D1 batch (snapshot current progress into history,
 * then reset progress to the empty state). For `revision_bump` it is
 * idempotent — a Part whose latest history already records the target revision
 * is skipped, so re-running the same bump is a no-op and never double-archives.
 *
 * Envelope columns (`part_progress.stateJson`, `activity_records
 * .visibilityOverrideJson`) are parsed through the same Zod schemas the API
 * boundary validates writes with; an unknown version throws
 * `INVARIANT_VIOLATION` so a missing read-time shim can't be ignored.
 */
export function createActivityRecordRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): ActivityRecordRepository {
  const ids = createIdGenerator();

  async function readPartProgress(
    activityRecordId: ActivityRecordId,
    partId: ActivityPartId,
  ): Promise<PartProgress | null> {
    const rows = await deps.db
      .select()
      .from(partProgress)
      .where(
        and(eq(partProgress.activityRecordId, activityRecordId), eq(partProgress.partId, partId)),
      )
      .limit(1);
    return rows[0] ? decodePartProgress(rows[0]) : null;
  }

  return {
    upsert: markWrite(async ({ activityId, participantId, now }) => {
      await deps.gate.assertWritable();
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
        .onConflictDoNothing();
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
      if (!row) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          "Activity record vanished immediately after upsert.",
          "record_upsert_failed",
        );
      }
      return decodeRecord(row);
    }),

    async byId(id) {
      const rows = await deps.db
        .select()
        .from(activityRecords)
        .where(eq(activityRecords.id, id))
        .limit(1);
      return rows[0] ? decodeRecord(rows[0]) : null;
    },

    async byParticipantAndActivity({ activityId, participantId }) {
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
      return rows[0] ? decodeRecord(rows[0]) : null;
    },

    async listByActivity(activityId) {
      const rows = await deps.db
        .select()
        .from(activityRecords)
        .where(eq(activityRecords.activityId, activityId))
        .orderBy(desc(activityRecords.updatedAt));
      return rows.map(decodeRecord);
    },

    setCompletion: markWrite(async ({ id, state, at }) => {
      await deps.gate.assertWritable();
      const updated = await deps.db
        .update(activityRecords)
        .set({
          completionState: state,
          completedAt: state === "completed" ? at : null,
          updatedAt: at,
        })
        .where(eq(activityRecords.id, id))
        .returning();
      const row = updated[0];
      if (!row) throw new DomainError("NOT_FOUND", "Activity record not found.", "not_found");
      return decodeRecord(row);
    }),

    setVisibilityOverride: markWrite(async ({ id, override, now }) => {
      await deps.gate.assertWritable();
      const updated = await deps.db
        .update(activityRecords)
        .set({ visibilityOverrideJson: encodeVisibilityOverride(override), updatedAt: now })
        .where(eq(activityRecords.id, id))
        .returning();
      const row = updated[0];
      if (!row) throw new DomainError("NOT_FOUND", "Activity record not found.", "not_found");
      return decodeRecord(row);
    }),

    getPartProgress: ({ activityRecordId, partId }) => readPartProgress(activityRecordId, partId),

    async listPartProgress(activityRecordId) {
      const rows = await deps.db
        .select()
        .from(partProgress)
        .where(eq(partProgress.activityRecordId, activityRecordId));
      return rows.map(decodePartProgress);
    },

    savePartProgress: markWrite(
      async ({ activityRecordId, partId, state, now, snapshotPriorAsRetry }) => {
        await deps.gate.assertWritable();
        const stateJson = encodeState(state);

        // For a quiz re-submission, snapshot the existing answers into history
        // before overwriting. The read happens before the batch; a single
        // participant does not edit one Part from two devices at once.
        let priorStateJson: string | null = null;
        if (snapshotPriorAsRetry) {
          const current = await readPartProgress(activityRecordId, partId);
          if (current) priorStateJson = encodeState(current.state);
        }

        const statements: unknown[] = [];
        if (priorStateJson !== null) {
          statements.push(
            deps.db.insert(partHistory).values({
              id: ids.generate(),
              activityRecordId,
              partId,
              stateJson: priorStateJson,
              reason: "retry",
              revisionIdAtTime: null,
              recordedAt: now,
            }),
          );
        }
        statements.push(
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
        );
        await deps.db.batch(statements as unknown as Statements);

        const saved = await readPartProgress(activityRecordId, partId);
        if (!saved) {
          throw new DomainError(
            "INVARIANT_VIOLATION",
            "Part progress vanished immediately after save.",
            "part_progress_save_failed",
          );
        }
        return saved;
      },
    ),

    async listPartHistory({ activityRecordId, partId }) {
      const rows = await deps.db
        .select()
        .from(partHistory)
        .where(
          partId === undefined
            ? eq(partHistory.activityRecordId, activityRecordId)
            : and(
                eq(partHistory.activityRecordId, activityRecordId),
                eq(partHistory.partId, partId),
              ),
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
      async ({ recordId, reason, revisionIdAtTime, resets, now }) => {
        await deps.gate.assertWritable();
        if (resets.length === 0) return;

        // Idempotency for revision bumps: skip Parts whose latest history already
        // records the target revision — re-running the same bump is a no-op.
        let effective = resets;
        if (reason === "revision_bump" && revisionIdAtTime !== null) {
          const history = await deps.db
            .select({
              partId: partHistory.partId,
              revisionIdAtTime: partHistory.revisionIdAtTime,
            })
            .from(partHistory)
            .where(eq(partHistory.activityRecordId, recordId))
            .orderBy(desc(partHistory.recordedAt));
          const latestRevisionByPart = new Map<string, string | null>();
          for (const h of history) {
            if (!latestRevisionByPart.has(h.partId))
              latestRevisionByPart.set(h.partId, h.revisionIdAtTime);
          }
          effective = resets.filter((r) => latestRevisionByPart.get(r.partId) !== revisionIdAtTime);
        }
        if (effective.length === 0) return;

        // Only Parts that already carry progress are reopened — an untouched Part
        // is already at its empty state, so there is nothing to preserve or reset.
        const current = await deps.db
          .select({ partId: partProgress.partId, stateJson: partProgress.stateJson })
          .from(partProgress)
          .where(
            and(
              eq(partProgress.activityRecordId, recordId),
              inArray(
                partProgress.partId,
                effective.map((r) => r.partId),
              ),
            ),
          );
        const currentStateByPart = new Map(current.map((p) => [p.partId, p.stateJson]));

        const statements: unknown[] = [];
        for (const reset of effective) {
          const priorStateJson = currentStateByPart.get(reset.partId);
          if (priorStateJson === undefined) continue;
          statements.push(
            deps.db.insert(partHistory).values({
              id: ids.generate(),
              activityRecordId: recordId,
              partId: reset.partId,
              stateJson: priorStateJson,
              reason,
              revisionIdAtTime,
              recordedAt: now,
            }),
            deps.db
              .update(partProgress)
              .set({ stateJson: encodeState(reset.resetState), updatedAt: now })
              .where(
                and(
                  eq(partProgress.activityRecordId, recordId),
                  eq(partProgress.partId, reset.partId),
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
        await deps.db.batch(statements as unknown as Statements);
      },
    ),
  };
}

function encodeState(state: PartProgressState): string {
  return JSON.stringify(partProgressStateEnvelopeSchema.parse({ v: 1, data: state }));
}

function decodeState(raw: string, recordId: string, partId: string): PartProgressState {
  try {
    return partProgressStateEnvelopeSchema.parse(JSON.parse(raw)).data;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Part progress for record ${recordId} part ${partId} has invalid stateJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

function encodeVisibilityOverride(override: VisibilityPreference | null): string | null {
  return override === null
    ? null
    : JSON.stringify(
        visibilityOverrideEnvelopeSchema.parse({ v: 1, data: { preference: override } }),
      );
}

function decodeRecord(row: typeof activityRecords.$inferSelect): ActivityRecord {
  let visibilityOverride: VisibilityPreference | null = null;
  if (row.visibilityOverrideJson !== null) {
    try {
      visibilityOverride = visibilityOverrideEnvelopeSchema.parse(
        JSON.parse(row.visibilityOverrideJson),
      ).data.preference;
    } catch (err) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Activity record ${row.id} has invalid visibilityOverrideJson: ${(err as Error).message}`,
        "envelope_invalid",
      );
    }
  }
  return {
    id: row.id as ActivityRecordId,
    activityId: row.activityId as LearningActivityId,
    participantId: row.participantId as UserId,
    completionState: row.completionState as CompletionState,
    completedAt: row.completedAt,
    visibilityOverride,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function decodePartProgress(row: typeof partProgress.$inferSelect): PartProgress {
  return {
    id: row.id,
    activityRecordId: row.activityRecordId as ActivityRecordId,
    partId: row.partId as ActivityPartId,
    state: decodeState(row.stateJson, row.activityRecordId, row.partId),
    updatedAt: row.updatedAt,
  };
}

function decodePartHistory(row: typeof partHistory.$inferSelect): PartHistory {
  return {
    id: row.id,
    activityRecordId: row.activityRecordId as ActivityRecordId,
    partId: row.partId as ActivityPartId,
    snapshot: decodeState(row.stateJson, row.activityRecordId, row.partId),
    reason: row.reason as PartHistoryReason,
    revisionIdAtTime: row.revisionIdAtTime as LibraryRevisionId | null,
    recordedAt: row.recordedAt,
  };
}
