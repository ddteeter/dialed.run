CREATE TABLE `reminder_email_days` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`covered_until` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_email_days_user_day` ON `reminder_email_days` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `reminder_email_days_covered_until` ON `reminder_email_days` (`covered_until`);