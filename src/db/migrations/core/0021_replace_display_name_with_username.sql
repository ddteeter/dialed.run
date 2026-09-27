CREATE TABLE `username_history` (
	`username` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`retired_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `username_history_user` ON `username_history` (`user_id`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_username_nocase` ON `user_profiles` ("username" COLLATE NOCASE);--> statement-breakpoint
DROP INDEX `user_profiles_display_name_nocase`;--> statement-breakpoint
ALTER TABLE `user_profiles` DROP COLUMN `display_name`;