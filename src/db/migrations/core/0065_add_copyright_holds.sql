CREATE TABLE `copyright_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`moderation_action_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`status` text NOT NULL,
	`hidden_at` integer NOT NULL,
	`purge_at` integer NOT NULL,
	`counter_notice_at` integer,
	`counter_notice_by` text,
	`restore_at` integer,
	`court_action_at` integer,
	`court_action_by` text,
	`case_closed_by` text,
	`settled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copyright_holds_action` ON `copyright_holds` (`moderation_action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `copyright_holds_live_subject` ON `copyright_holds` (`subject_type`,`subject_id`) WHERE "copyright_holds"."status" IN ('hidden', 'purging');--> statement-breakpoint
CREATE INDEX `copyright_holds_status_purge` ON `copyright_holds` (`status`,`purge_at`);--> statement-breakpoint
CREATE INDEX `copyright_holds_status_restore` ON `copyright_holds` (`status`,`restore_at`);--> statement-breakpoint
CREATE INDEX `copyright_holds_owner` ON `copyright_holds` (`owner_id`);