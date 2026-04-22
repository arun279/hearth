import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";
import { learningActivities } from "./activities.ts";

export const activityRecords = sqliteTable(
  "activity_records",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => learningActivities.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => users.id),
    completionState: text("completion_state").notNull().default("in_progress"),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    visibilityOverrideJson: text("visibility_override_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("activity_records_activity_participant_idx").on(t.activityId, t.participantId),
    index("activity_records_participant_updated_idx").on(t.participantId, t.updatedAt),
    check(
      "activity_records_completion_state",
      sql`${t.completionState} IN ('in_progress', 'completed')`,
    ),
  ],
);

// CASCADE justification: part_progress rows have no meaning without their parent
// activity_record. When the record is removed we want the child progress gone too.
export const partProgress = sqliteTable(
  "part_progress",
  {
    id: text("id").primaryKey(),
    activityRecordId: text("activity_record_id")
      .notNull()
      .references(() => activityRecords.id, { onDelete: "cascade" }),
    partId: text("part_id").notNull(),
    stateJson: text("state_json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("part_progress_record_part_idx").on(t.activityRecordId, t.partId)],
);

// CASCADE justification: same rationale as part_progress.
export const partHistory = sqliteTable(
  "part_history",
  {
    id: text("id").primaryKey(),
    activityRecordId: text("activity_record_id")
      .notNull()
      .references(() => activityRecords.id, { onDelete: "cascade" }),
    partId: text("part_id").notNull(),
    stateJson: text("state_json").notNull(),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("part_history_record_part_idx").on(t.activityRecordId, t.partId)],
);

// Surrogate id + UNIQUE on the logical 4-column composite. Composite
// primary keys are avoided because Drizzle's ON CONFLICT support for them
// has bugs (drizzle-orm #4427, #475) that silently break UPSERTs.
export const evidenceSignals = sqliteTable(
  "evidence_signals",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => learningActivities.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => users.id),
    partId: text("part_id").notNull(),
    signalType: text("signal_type").notNull(),
    valueJson: text("value_json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("evidence_signals_unique_idx").on(
      t.activityId,
      t.participantId,
      t.partId,
      t.signalType,
    ),
  ],
);
