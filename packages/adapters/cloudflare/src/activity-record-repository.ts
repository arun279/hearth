import { activityRecords, partProgress } from "@hearth/db/schema";
import {
  type ActivityPartId,
  type ActivityRecord,
  type ActivityRecordId,
  type CompletionState,
  DomainError,
  type LearningActivityId,
  type PartProgress,
  type PartProgressState,
  partProgressEnvelopeSchema,
  type UserId,
  type VisibilityPreference,
  visibilityOverrideEnvelopeSchema,
} from "@hearth/domain";
import { type ActivityRecordRepository, markWrite } from "@hearth/ports";
import { and, eq } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { createIdGenerator } from "./id-generator.ts";

/**
 * D1 implementation of `ActivityRecordRepository` (M10 surface).
 *
 * - `upsert` is an idempotent get-or-create on the UNIQUE
 *   (activityId, participantId) index: INSERT … ON CONFLICT DO NOTHING,
 *   then read the canonical row back. A concurrent first-touch from the
 *   same participant collapses to one row.
 * - `savePartProgress` UPSERTs the (record, part) row and touches the
 *   parent record's `updatedAt`. The stored `stateJson` is the versioned
 *   envelope, parsed through the same Zod schema on read so a malformed
 *   row surfaces as `INVARIANT_VIOLATION` rather than rendering a malformed value.
 * - `setVisibilityOverride` writes (or clears, on `null`) the record-level
 *   override envelope.
 *
 * Resilience invariants 2 + 3: every mutation calls `gate.assertWritable()`
 * first and is wrapped in `markWrite()` so it appears in the
 * killswitch-coverage CASES.
 */
export function createActivityRecordRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): ActivityRecordRepository {
  const ids = createIdGenerator();

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

    byParticipantAndActivity(activityId, participantId) {
      return loadRecord(activityId, participantId);
    },

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
      await deps.db.batch([
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
      ] as unknown as Parameters<typeof deps.db.batch>[0]);
    }),
  };
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
