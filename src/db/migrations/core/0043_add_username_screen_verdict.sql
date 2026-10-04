ALTER TABLE `user_profiles` ADD `username_screen` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `username_screened_at` integer;--> statement-breakpoint
CREATE INDEX `user_profiles_username_screen_pending` ON `user_profiles` (`username_screen`) WHERE "user_profiles"."username_screen" IN ('unknown', 'checking');