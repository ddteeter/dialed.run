CREATE TABLE `manual_conditions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`temp_c` real NOT NULL,
	`set_at` integer NOT NULL,
	`sky` text
);
--> statement-breakpoint
CREATE TABLE `weather_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`lat_r` real NOT NULL,
	`lng_r` real NOT NULL,
	`hour_bucket` integer NOT NULL,
	`temp_c` real NOT NULL,
	`feels_like_c` real NOT NULL,
	`humidity` real NOT NULL,
	`wind_kph` real NOT NULL,
	`precip_mm` real NOT NULL,
	`condition` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`time_zone` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_cache_key` ON `weather_observations` (`lat_r`,`lng_r`,`hour_bucket`);