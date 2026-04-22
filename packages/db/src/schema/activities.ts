import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { libraryItems, libraryRevisions } from "./library.ts";
import { tracks } from "./tracks.ts";

export const learningActivities = sqliteTable(
  "learning_activities",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    title: text("title").notNull(),
    description: text("description"),
    partsJson: text("parts_json").notNull(),
    flowJson: text("flow_json").notNull(),
    audienceJson: text("audience_json").notNull(),
    windowJson: text("window_json"),
    postClosePolicyJson: text("post_close_policy_json"),
    completionRuleJson: text("completion_rule_json").notNull(),
    participationMode: text("participation_mode").notNull().default("individual"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("learning_activities_track_idx").on(t.trackId),
    check("learning_activities_participation_mode", sql`${t.participationMode} IN ('individual')`),
  ],
);

export const activityLibraryRefs = sqliteTable(
  "activity_library_refs",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => learningActivities.id),
    libraryItemId: text("library_item_id")
      .notNull()
      .references(() => libraryItems.id),
    pinnedRevisionId: text("pinned_revision_id").references(() => libraryRevisions.id),
  },
  (t) => [
    uniqueIndex("activity_library_refs_unique_idx").on(t.activityId, t.libraryItemId),
    index("activity_library_refs_library_idx").on(t.libraryItemId),
  ],
);

export const activityPrerequisites = sqliteTable(
  "activity_prerequisites",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => learningActivities.id),
    prerequisiteActivityId: text("prerequisite_activity_id")
      .notNull()
      .references(() => learningActivities.id),
  },
  (t) => [
    uniqueIndex("activity_prerequisites_unique_idx").on(t.activityId, t.prerequisiteActivityId),
  ],
);

export const activitySuggestedSequences = sqliteTable(
  "activity_suggested_sequences",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => learningActivities.id),
    nextActivityId: text("next_activity_id")
      .notNull()
      .references(() => learningActivities.id),
  },
  (t) => [
    uniqueIndex("activity_suggested_sequences_unique_idx").on(t.activityId, t.nextActivityId),
  ],
);
