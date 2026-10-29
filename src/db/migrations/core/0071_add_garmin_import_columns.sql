ALTER TABLE `imports` ADD `garmin_activity_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `imports_garmin_activity` ON `imports` (`user_id`,`garmin_activity_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `rpe` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `effort_source` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `device_name` text;