CREATE TABLE `notification_preferences` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`email` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_pk` ON `notification_preferences` (`user_id`,`kind`);