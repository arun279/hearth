ALTER TABLE `tracks` ADD `peer_progress_visibility` text DEFAULT 'shared' NOT NULL CONSTRAINT `tracks_peer_progress_visibility` CHECK (`peer_progress_visibility` IN ('shared', 'facilitator_only'));--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `visibility_preference_json`;--> statement-breakpoint
ALTER TABLE `activity_records` DROP COLUMN `visibility_override_json`;
