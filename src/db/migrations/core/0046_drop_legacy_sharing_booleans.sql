DROP INDEX `entries_public_created`;--> statement-breakpoint
DROP INDEX `entries_user_public_created`;--> statement-breakpoint
ALTER TABLE `outfit_entries` DROP COLUMN `is_public`;--> statement-breakpoint
ALTER TABLE `user_profiles` DROP COLUMN `share_default`;