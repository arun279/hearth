CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deactivated_at` integer,
	`deactivated_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	`attribution_preference` text DEFAULT 'preserve_name' NOT NULL,
	`visibility_preference_json` text,
	FOREIGN KEY (`deactivated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_attribution_preference" CHECK("users"."attribution_preference" IN ('preserve_name', 'anonymize'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_library_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`library_item_id` text NOT NULL,
	`pinned_revision_id` text,
	FOREIGN KEY (`activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pinned_revision_id`) REFERENCES `library_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_library_refs_unique_idx` ON `activity_library_refs` (`activity_id`,`library_item_id`);--> statement-breakpoint
CREATE INDEX `activity_library_refs_library_idx` ON `activity_library_refs` (`library_item_id`);--> statement-breakpoint
CREATE TABLE `activity_prerequisites` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`prerequisite_activity_id` text NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prerequisite_activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_prerequisites_unique_idx` ON `activity_prerequisites` (`activity_id`,`prerequisite_activity_id`);--> statement-breakpoint
CREATE TABLE `activity_suggested_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`next_activity_id` text NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`next_activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_suggested_sequences_unique_idx` ON `activity_suggested_sequences` (`activity_id`,`next_activity_id`);--> statement-breakpoint
CREATE TABLE `learning_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`parts_json` text NOT NULL,
	`flow_json` text NOT NULL,
	`audience_json` text NOT NULL,
	`window_json` text,
	`post_close_policy_json` text,
	`completion_rule_json` text NOT NULL,
	`participation_mode` text DEFAULT 'individual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "learning_activities_participation_mode" CHECK("learning_activities"."participation_mode" IN ('individual'))
);
--> statement-breakpoint
CREATE INDEX `learning_activities_track_idx` ON `learning_activities` (`track_id`);--> statement-breakpoint
CREATE TABLE `group_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'participant' NOT NULL,
	`joined_at` integer NOT NULL,
	`removed_at` integer,
	`removed_by` text,
	`attribution_on_leave` text,
	`display_name_snapshot` text,
	`profile_nickname` text,
	`profile_avatar_url` text,
	`profile_bio` text,
	`profile_updated_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "group_memberships_role" CHECK("group_memberships"."role" IN ('participant', 'admin')),
	CONSTRAINT "group_memberships_attribution_on_leave" CHECK("group_memberships"."attribution_on_leave" IS NULL OR "group_memberships"."attribution_on_leave" IN ('preserve_name', 'anonymize'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_memberships_group_user_idx` ON `group_memberships` (`group_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `group_memberships_user_idx` ON `group_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`admission_policy` text DEFAULT 'invite_only' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`archived_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "groups_admission_policy" CHECK("groups"."admission_policy" IN ('open', 'invite_only')),
	CONSTRAINT "groups_status" CHECK("groups"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE `approved_emails` (
	`email` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `instance_operators` (
	`user_id` text PRIMARY KEY NOT NULL,
	`granted_at` integer NOT NULL,
	`granted_by` text NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Hearth' NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "instance_settings_singleton" CHECK("instance_settings"."id" = 'instance')
);
--> statement-breakpoint
CREATE TABLE `group_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`track_id` text,
	`token` text NOT NULL,
	`email` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`consumed_by` text,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consumed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_invitations_token_unique` ON `group_invitations` (`token`);--> statement-breakpoint
CREATE INDEX `group_invitations_expires_idx` ON `group_invitations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`tags_json` text NOT NULL,
	`current_revision_id` text,
	`uploaded_by` text NOT NULL,
	`retired_at` integer,
	`retired_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`retired_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_items_group_idx` ON `library_items` (`group_id`);--> statement-breakpoint
CREATE TABLE `library_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`library_item_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`original_filename` text,
	`uploaded_by` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`library_item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_revisions_item_number_idx` ON `library_revisions` (`library_item_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `library_stewards` (
	`id` text PRIMARY KEY NOT NULL,
	`library_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	`granted_by` text NOT NULL,
	FOREIGN KEY (`library_item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_stewards_item_user_idx` ON `library_stewards` (`library_item_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `pending_uploads` (
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
	CONSTRAINT "pending_uploads_context" CHECK("pending_uploads"."context" IN ('library', 'pending_contribution'))
);
--> statement-breakpoint
CREATE INDEX `pending_uploads_expires_at_idx` ON `pending_uploads` (`expires_at`);--> statement-breakpoint
CREATE TABLE `activity_records` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`completion_state` text DEFAULT 'in_progress' NOT NULL,
	`completed_at` integer,
	`visibility_override_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activity_records_completion_state" CHECK("activity_records"."completion_state" IN ('in_progress', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_records_activity_participant_idx` ON `activity_records` (`activity_id`,`participant_id`);--> statement-breakpoint
CREATE INDEX `activity_records_participant_updated_idx` ON `activity_records` (`participant_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `evidence_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`part_id` text NOT NULL,
	`signal_type` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_signals_unique_idx` ON `evidence_signals` (`activity_id`,`participant_id`,`part_id`,`signal_type`);--> statement-breakpoint
CREATE TABLE `part_history` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_record_id` text NOT NULL,
	`part_id` text NOT NULL,
	`state_json` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`activity_record_id`) REFERENCES `activity_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `part_history_record_part_idx` ON `part_history` (`activity_record_id`,`part_id`);--> statement-breakpoint
CREATE TABLE `part_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_record_id` text NOT NULL,
	`part_id` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`activity_record_id`) REFERENCES `activity_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `part_progress_record_part_idx` ON `part_progress` (`activity_record_id`,`part_id`);--> statement-breakpoint
CREATE TABLE `session_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`recorded_by` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_attendance_session_user_idx` ON `session_attendance` (`session_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `study_session_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `learning_activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_session_activities_unique_idx` ON `study_session_activities` (`session_id`,`activity_id`);--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`scheduled_at` integer NOT NULL,
	`duration_minutes` integer,
	`location` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `study_sessions_track_scheduled_idx` ON `study_sessions` (`track_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `system_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`set_by` text,
	`set_at` integer NOT NULL,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`polled_at` integer NOT NULL,
	`metrics_json` text NOT NULL,
	`is_successful` integer NOT NULL,
	CONSTRAINT "usage_snapshots_is_successful" CHECK("usage_snapshots"."is_successful" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `usage_snapshots_polled_at_idx` ON `usage_snapshots` (`polled_at`);--> statement-breakpoint
CREATE TABLE `pending_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pending_contributions_status" CHECK("pending_contributions"."status" IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `pending_contributions_track_status_idx` ON `pending_contributions` (`track_id`,`status`);--> statement-breakpoint
CREATE TABLE `track_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'participant' NOT NULL,
	`enrolled_at` integer NOT NULL,
	`left_at` integer,
	`left_by` text,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`left_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "track_enrollments_role" CHECK("track_enrollments"."role" IN ('participant', 'facilitator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `track_enrollments_track_user_idx` ON `track_enrollments` (`track_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `track_enrollments_user_idx` ON `track_enrollments` (`user_id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`track_structure_json` text NOT NULL,
	`contribution_policy_json` text NOT NULL,
	`paused_at` integer,
	`archived_at` integer,
	`archived_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tracks_status" CHECK("tracks"."status" IN ('active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `tracks_group_status_idx` ON `tracks` (`group_id`,`status`);