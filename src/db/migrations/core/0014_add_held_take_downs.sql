CREATE TABLE `held_take_downs` (
	`action_id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `held_take_downs_subject` ON `held_take_downs` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `held_take_downs_entry` ON `held_take_downs` (`entry_id`);--> statement-breakpoint
ALTER TABLE `copyright_holds` DROP COLUMN `taken_down_by`;