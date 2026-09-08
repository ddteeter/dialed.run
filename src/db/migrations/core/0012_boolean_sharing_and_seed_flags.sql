PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`seeded` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_brands`("id", "name", "normalized", "seeded") SELECT "id", "name", "normalized", "seeded" FROM `brands`;--> statement-breakpoint
DROP TABLE `brands`;--> statement-breakpoint
ALTER TABLE `__new_brands` RENAME TO `brands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `brands_normalized` ON `brands` (`normalized`);--> statement-breakpoint
CREATE TABLE `__new_outfit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`verdict` integer,
	`is_public` integer DEFAULT true NOT NULL,
	`caption` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_outfit_entries`("id", "run_id", "user_id", "verdict", "is_public", "caption", "created_at") SELECT "id", "run_id", "user_id", "verdict", "is_public", "caption", "created_at" FROM `outfit_entries`;--> statement-breakpoint
DROP TABLE `outfit_entries`;--> statement-breakpoint
ALTER TABLE `__new_outfit_entries` RENAME TO `outfit_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `entries_run` ON `outfit_entries` (`run_id`);--> statement-breakpoint
CREATE INDEX `entries_user_created` ON `outfit_entries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entries_public_created` ON `outfit_entries` (`is_public`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`city_label` text,
	`lat` real,
	`lng` real,
	`thermal_level` integer,
	`temp_unit` text,
	`distance_unit` text,
	`share_default` integer DEFAULT true NOT NULL,
	`onboarding_complete` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user_profiles`("user_id", "display_name", "city_label", "lat", "lng", "thermal_level", "temp_unit", "distance_unit", "share_default", "onboarding_complete") SELECT "user_id", "display_name", "city_label", "lat", "lng", "thermal_level", "temp_unit", "distance_unit", "share_default", "onboarding_complete" FROM `user_profiles`;--> statement-breakpoint
DROP TABLE `user_profiles`;--> statement-breakpoint
ALTER TABLE `__new_user_profiles` RENAME TO `user_profiles`;--> statement-breakpoint
-- Hand-corrected. drizzle-kit re-emits an expression index by quoting the
-- whole expression as one identifier -- `"display_name" COLLATE NOCASE` --
-- which SQLite rejects with `no such column`. It only surfaces on a table
-- rebuild, so a boolean conversion on an unrelated column silently takes
-- the search index with it. Caught by the unit suite, which applies every
-- migration to a fresh D1 before it runs.
CREATE INDEX `user_profiles_display_name_nocase` ON `user_profiles` ("display_name" COLLATE NOCASE);