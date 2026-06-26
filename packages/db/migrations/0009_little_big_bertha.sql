ALTER TABLE `tracks` ADD `peer_progress_visibility` text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `visibility_preference_json`;--> statement-breakpoint
ALTER TABLE `activity_records` DROP COLUMN `visibility_override_json`;