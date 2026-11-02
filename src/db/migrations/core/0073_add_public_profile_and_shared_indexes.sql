DROP INDEX `entries_audience_created`;--> statement-breakpoint
DROP INDEX `entries_user_audience_created`;--> statement-breakpoint
CREATE INDEX `entries_shared_created` ON `outfit_entries` (`moderation_status`,`created_at`) WHERE "outfit_entries"."audience" in ('runners', 'world');--> statement-breakpoint
CREATE INDEX `entries_user_shared_created` ON `outfit_entries` (`user_id`,`moderation_status`,`created_at`) WHERE "outfit_entries"."audience" in ('runners', 'world');--> statement-breakpoint
CREATE INDEX `entries_user_world_created` ON `outfit_entries` (`user_id`,`moderation_status`,`created_at`) WHERE "outfit_entries"."audience" = 'world';--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `public_profile` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `public_closet` integer DEFAULT false NOT NULL;