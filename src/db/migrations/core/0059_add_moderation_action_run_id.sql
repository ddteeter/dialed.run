ALTER TABLE `moderation_actions` ADD `run_id` text;--> statement-breakpoint
CREATE INDEX `moderation_actions_run` ON `moderation_actions` (`run_id`);