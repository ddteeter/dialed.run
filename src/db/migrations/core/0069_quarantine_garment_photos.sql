PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_quarantined_content` (
	`id` text PRIMARY KEY NOT NULL,
	`moderation_action_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`entry_id` text,
	`entry_snapshot` text NOT NULL,
	`photos_snapshot` text NOT NULL,
	`quarantined_at` integer NOT NULL,
	`retain_until` integer NOT NULL,
	`ncmec_reported_at` integer,
	`ncmec_report_id` text,
	`uploader_snapshot` text
);
--> statement-breakpoint
INSERT INTO `__new_quarantined_content`("id", "moderation_action_id", "subject_type", "subject_id", "uploader_id", "entry_id", "entry_snapshot", "photos_snapshot", "quarantined_at", "retain_until", "ncmec_reported_at", "ncmec_report_id", "uploader_snapshot") SELECT "id", "moderation_action_id", "subject_type", "subject_id", "uploader_id", "entry_id", "entry_snapshot", "photos_snapshot", "quarantined_at", "retain_until", "ncmec_reported_at", "ncmec_report_id", "uploader_snapshot" FROM `quarantined_content`;--> statement-breakpoint
DROP TABLE `quarantined_content`;--> statement-breakpoint
ALTER TABLE `__new_quarantined_content` RENAME TO `quarantined_content`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `quarantined_content_quarantined` ON `quarantined_content` (`quarantined_at`);--> statement-breakpoint
CREATE INDEX `quarantined_content_retain` ON `quarantined_content` (`retain_until`);--> statement-breakpoint
CREATE INDEX `quarantined_content_action` ON `quarantined_content` (`moderation_action_id`);