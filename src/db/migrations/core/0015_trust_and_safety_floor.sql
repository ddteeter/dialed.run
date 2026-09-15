CREATE TABLE `blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_pk` ON `blocks` (`blocker_id`,`blocked_id`);--> statement-breakpoint
CREATE INDEX `blocks_blocked` ON `blocks` (`blocked_id`);--> statement-breakpoint
CREATE TABLE `domain_denylist` (
	`domain` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photo_screenings` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_scope` text NOT NULL,
	`photo_id` text NOT NULL,
	`model` text NOT NULL,
	`scores` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photo_screenings_photo` ON `photo_screenings` (`photo_scope`,`photo_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_one_per_reporter` ON `reports` (`reporter_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `reports_subject` ON `reports` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_queue_subject` ON `review_queue` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `review_queue_status_created` ON `review_queue` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `entry_photos` ADD `screen_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX `entry_photos_screen_status` ON `entry_photos` (`screen_status`,`id`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `banned_at` integer;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `ban_reason` text;