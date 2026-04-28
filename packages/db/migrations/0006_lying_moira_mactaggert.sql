DROP INDEX `library_items_group_idx`;--> statement-breakpoint
CREATE INDEX `library_items_active_by_group_idx` ON `library_items` (`group_id`) WHERE "library_items"."retired_at" IS NULL;