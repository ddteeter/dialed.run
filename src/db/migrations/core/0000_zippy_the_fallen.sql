CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`seeded` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_normalized` ON `brands` (`normalized`);--> statement-breakpoint
CREATE TABLE `cron_checkpoints` (
	`cron_name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entry_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`photo_key` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entry_tags` (
	`entry_id` text NOT NULL,
	`tag` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_tags_pk` ON `entry_tags` (`entry_id`,`tag`);--> statement-breakpoint
CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follows_pk` ON `follows` (`follower_id`,`followee_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`failure_reason` text,
	`run_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`body` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe` ON `notifications` (`user_id`,`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_read` ON `notifications` (`user_id`,`read`);--> statement-breakpoint
CREATE TABLE `outfit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`verdict` integer,
	`is_public` integer DEFAULT 1 NOT NULL,
	`caption` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_run` ON `outfit_entries` (`run_id`);--> statement-breakpoint
CREATE INDEX `entries_user_created` ON `outfit_entries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entries_public_created` ON `outfit_entries` (`is_public`,`created_at`);--> statement-breakpoint
CREATE TABLE `outfit_entry_items` (
	`entry_id` text NOT NULL,
	`item_id` text NOT NULL,
	`flag` text,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_items_pk` ON `outfit_entry_items` (`entry_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `processed_webhook_events` (
	`object_id` text NOT NULL,
	`aspect_type` text NOT NULL,
	`event_time` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_pk` ON `processed_webhook_events` (`object_id`,`aspect_type`,`event_time`);--> statement-breakpoint
CREATE TABLE `product_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text NOT NULL,
	`rung` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`source_url` text,
	`image_key` text,
	`category_hint` text,
	`fabric_composition` text,
	`fabric_parts` text,
	`weight` text,
	`fabric` text,
	`wind_resistant` integer,
	`water_resistant` integer,
	`extracted` text,
	`extraction_status` text DEFAULT 'none' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_brand_name` ON `products` (`brand_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'useful' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_pk` ON `reactions` (`entry_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_s` integer NOT NULL,
	`distance_m` real NOT NULL,
	`lat` real,
	`lng` real,
	`indoor` integer DEFAULT 0 NOT NULL,
	`effort` text,
	`title` text NOT NULL,
	`weather_status` text DEFAULT 'none' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_user_started` ON `runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `strava_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`city_label` text,
	`lat` real,
	`lng` real,
	`thermal_level` integer,
	`temp_unit` text,
	`distance_unit` text,
	`share_default` integer DEFAULT 1 NOT NULL,
	`onboarding_complete` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wardrobe_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`layer` text,
	`weight` text,
	`fabric` text,
	`wind_resistant` integer,
	`water_resistant` integer,
	`est_temp_low_c` real,
	`est_temp_high_c` real,
	`brand` text,
	`name` text NOT NULL,
	`size` text,
	`color` text,
	`photo_key` text,
	`product_url` text,
	`product_id` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`retired` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'ok' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wardrobe_user_category` ON `wardrobe_items` (`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `wardrobe_product` ON `wardrobe_items` (`product_id`);