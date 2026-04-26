PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pending_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`uploader_user_id` text NOT NULL,
	`group_id` text NOT NULL,
	`library_item_id` text,
	`revision_id` text NOT NULL,
	`declared_size_bytes` integer NOT NULL,
	`declared_mime_type` text NOT NULL,
	`context` text NOT NULL,
	`pending_contribution_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pending_uploads_context" CHECK("__new_pending_uploads"."context" IN ('library', 'pending_contribution', 'avatar'))
);
--> statement-breakpoint
INSERT INTO `__new_pending_uploads`("id", "uploader_user_id", "group_id", "library_item_id", "revision_id", "declared_size_bytes", "declared_mime_type", "context", "pending_contribution_id", "created_at", "expires_at") SELECT "id", "uploader_user_id", "group_id", "library_item_id", "revision_id", "declared_size_bytes", "declared_mime_type", "context", "pending_contribution_id", "created_at", "expires_at" FROM `pending_uploads`;--> statement-breakpoint
DROP TABLE `pending_uploads`;--> statement-breakpoint
ALTER TABLE `__new_pending_uploads` RENAME TO `pending_uploads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `pending_uploads_expires_at_idx` ON `pending_uploads` (`expires_at`);