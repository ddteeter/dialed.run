CREATE TABLE `manual_conditions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`temp_c` real NOT NULL,
	`set_at` integer NOT NULL
);
--> statement-breakpoint
-- Carry each band already set into its run's own row. The legacy manual
-- cache rows stay where they are: readers skip them from this migration on,
-- a real fetch upgrades them in place, and deleting them is a later,
-- destructive step (expand -> contract).
INSERT OR IGNORE INTO `manual_conditions` (`run_id`, `temp_c`, `set_at`)
SELECT `run_id`, `temp_c`, `fetched_at` FROM `weather_observations`
WHERE `source` = 'manual' AND `run_id` IS NOT NULL;
