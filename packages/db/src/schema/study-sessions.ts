import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";
import { learningActivities } from "./activities.ts";
import { tracks } from "./tracks.ts";

export const studySessions = sqliteTable(
  "study_sessions",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    title: text("title").notNull(),
    description: text("description"),
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }).notNull(),
    durationMinutes: integer("duration_minutes"),
    location: text("location"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    byTrackScheduled: index("study_sessions_track_scheduled_idx").on(t.trackId, t.scheduledAt),
  }),
);

export const studySessionActivities = sqliteTable(
  "study_session_activities",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    activityId: text("activity_id")
      .notNull()
      .references(() => learningActivities.id),
    displayOrder: integer("display_order").notNull(),
  },
  (t) => ({
    sessionActivityUnique: uniqueIndex("study_session_activities_unique_idx").on(
      t.sessionId,
      t.activityId,
    ),
  }),
);

export const sessionAttendance = sqliteTable(
  "session_attendance",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({
    sessionUserUnique: uniqueIndex("session_attendance_session_user_idx").on(t.sessionId, t.userId),
  }),
);
