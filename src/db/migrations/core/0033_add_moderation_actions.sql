CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_owner_id` text,
	`reason` text NOT NULL,
	`preserved_key` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_subject` ON `moderation_actions` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `moderation_actions_owner` ON `moderation_actions` (`subject_owner_id`,`created_at`);