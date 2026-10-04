ALTER TABLE `outfit_entries` ADD `audience` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `default_audience` text DEFAULT 'runners' NOT NULL;--> statement-breakpoint
UPDATE `outfit_entries` SET `audience` = CASE WHEN `is_public` = 1 THEN 'runners' ELSE 'private' END;--> statement-breakpoint
UPDATE `user_profiles` SET `default_audience` = CASE WHEN `share_default` = 1 THEN 'runners' ELSE 'private' END;--> statement-breakpoint
CREATE INDEX `entries_audience_created` ON `outfit_entries` (`audience`,`moderation_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `entries_user_audience_created` ON `outfit_entries` (`user_id`,`audience`,`moderation_status`,`created_at`);
