CREATE TABLE `strava_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`created_at` integer NOT NULL
);
