import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "../auth-tables.ts";

/** Killswitch flag store + alerter throttles + per-instance byte budgets. */
export const systemFlags = sqliteTable("system_flags", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  setBy: text("set_by").references(() => users.id),
  setAt: integer("set_at", { mode: "timestamp_ms" }).notNull(),
});

/** One row per hourly usage poll. Worst percentage across metrics drives killswitch. */
export const usageSnapshots = sqliteTable(
  "usage_snapshots",
  {
    id: text("id").primaryKey(),
    polledAt: integer("polled_at", { mode: "timestamp_ms" }).notNull(),
    metricsJson: text("metrics_json").notNull(),
    isSuccessful: integer("is_successful").notNull(),
  },
  (t) => [
    index("usage_snapshots_polled_at_idx").on(t.polledAt),
    check("usage_snapshots_is_successful", sql`${t.isSuccessful} IN (0, 1)`),
  ],
);
