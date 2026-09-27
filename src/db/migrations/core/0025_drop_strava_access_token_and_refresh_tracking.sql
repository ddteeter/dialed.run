PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_strava_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`refresh_token` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_strava_revocations`("id", "created_at", "refresh_token") SELECT "id", "created_at", "refresh_token" FROM `strava_revocations`;--> statement-breakpoint
DROP TABLE `strava_revocations`;--> statement-breakpoint
ALTER TABLE `__new_strava_revocations` RENAME TO `strava_revocations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `strava_connections` DROP COLUMN `access_token`;--> statement-breakpoint
ALTER TABLE `strava_connections` DROP COLUMN `expires_at`;--> statement-breakpoint
ALTER TABLE `strava_connections` DROP COLUMN `status`;--> statement-breakpoint
ALTER TABLE `strava_connections` DROP COLUMN `refresh_failure_count`;--> statement-breakpoint
ALTER TABLE `strava_connections` DROP COLUMN `refresh_first_failed_at`;