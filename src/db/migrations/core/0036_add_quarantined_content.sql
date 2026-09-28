CREATE TABLE `quarantined_content` (
	`id` text PRIMARY KEY NOT NULL,
	`moderation_action_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`entry_snapshot` text NOT NULL,
	`photos_snapshot` text NOT NULL,
	`quarantined_at` integer NOT NULL,
	`retain_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quarantined_content_quarantined` ON `quarantined_content` (`quarantined_at`);--> statement-breakpoint
CREATE INDEX `quarantined_content_retain` ON `quarantined_content` (`retain_until`);