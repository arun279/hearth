PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_part_history` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_record_id` text NOT NULL,
	`part_id` text NOT NULL,
	`state_json` text NOT NULL,
	`reason` text NOT NULL,
	`revision_id_at_time` text,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`activity_record_id`) REFERENCES `activity_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id_at_time`) REFERENCES `library_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "part_history_reason" CHECK("__new_part_history"."reason" IN ('retry', 'revision_bump', 'facilitator_reset'))
);
--> statement-breakpoint
INSERT INTO `__new_part_history`("id", "activity_record_id", "part_id", "state_json", "reason", "revision_id_at_time", "recorded_at") SELECT "id", "activity_record_id", "part_id", "state_json", 'retry', NULL, "recorded_at" FROM `part_history`;--> statement-breakpoint
DROP TABLE `part_history`;--> statement-breakpoint
ALTER TABLE `__new_part_history` RENAME TO `part_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `part_history_record_part_idx` ON `part_history` (`activity_record_id`,`part_id`);
