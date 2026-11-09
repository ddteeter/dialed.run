CREATE TABLE `run_conditions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`feels_like_c` real,
	`min_feels_like_c` real,
	`max_feels_like_c` real,
	`precip_class` text,
	`source` text,
	`verdict` integer,
	`entry_created_at` integer,
	`entry_shared` integer DEFAULT false NOT NULL,
	`judged_feels_like_c` real GENERATED ALWAYS AS (CASE WHEN "verdict" < 0 THEN "min_feels_like_c" WHEN "verdict" > 0 THEN "max_feels_like_c" ELSE "feels_like_c" END) VIRTUAL,
	`judged_bucket` integer GENERATED ALWAYS AS (CAST("judged_feels_like_c" + 1000 AS INTEGER) - 1000) VIRTUAL
);
--> statement-breakpoint
CREATE INDEX `run_conditions_band` ON `run_conditions` (`precip_class`,`judged_bucket`,`entry_created_at`) WHERE "run_conditions"."entry_shared" = 1 AND "run_conditions"."source" != 'manual';--> statement-breakpoint
CREATE INDEX `run_conditions_user` ON `run_conditions` (`user_id`);