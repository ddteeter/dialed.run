CREATE TABLE `gave_up` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason` text NOT NULL,
	`raw_error` text,
	`tries` integer NOT NULL,
	`first_failed_at` integer NOT NULL,
	`last_failed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gave_up_kind_subject` ON `gave_up` (`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `gave_up_last_failed` ON `gave_up` (`last_failed_at`);