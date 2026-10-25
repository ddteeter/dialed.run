CREATE TABLE `removed_fingerprints` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`moderation_action_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `removed_fingerprints_created` ON `removed_fingerprints` (`created_at`);