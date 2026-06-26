PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`peer_progress_visibility` text DEFAULT 'shared' NOT NULL,
	`track_structure_json` text NOT NULL,
	`contribution_policy_json` text NOT NULL,
	`paused_at` integer,
	`archived_at` integer,
	`archived_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tracks_status" CHECK("__new_tracks"."status" IN ('active', 'paused', 'archived')),
	CONSTRAINT "tracks_peer_progress_visibility" CHECK("__new_tracks"."peer_progress_visibility" IN ('shared', 'facilitator_only'))
);
--> statement-breakpoint
-- peer_progress_visibility is added in this same rebuild, so carried rows take its DEFAULT ('shared'); it is omitted from the carry-over (drizzle-kit emits it in the SELECT, which fails against the pre-rebuild table).
INSERT INTO `__new_tracks`("id", "group_id", "name", "description", "status", "track_structure_json", "contribution_policy_json", "paused_at", "archived_at", "archived_by", "created_at", "updated_at") SELECT "id", "group_id", "name", "description", "status", "track_structure_json", "contribution_policy_json", "paused_at", "archived_at", "archived_by", "created_at", "updated_at" FROM `tracks`;--> statement-breakpoint
DROP TABLE `tracks`;--> statement-breakpoint
ALTER TABLE `__new_tracks` RENAME TO `tracks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tracks_group_status_idx` ON `tracks` (`group_id`,`status`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `visibility_preference_json`;--> statement-breakpoint
ALTER TABLE `activity_records` DROP COLUMN `visibility_override_json`;