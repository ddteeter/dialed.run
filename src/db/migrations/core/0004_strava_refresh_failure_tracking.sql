ALTER TABLE `strava_connections` ADD `refresh_failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `strava_connections` ADD `refresh_first_failed_at` integer;