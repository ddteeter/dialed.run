CREATE TABLE `account_deletions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	`purge_after` integer NOT NULL,
	`purge_started_at` integer
);
--> statement-breakpoint
CREATE INDEX `account_deletions_due` ON `account_deletions` (`purge_after`);