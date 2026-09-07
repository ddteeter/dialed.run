PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`body` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "kind", "subject_id", "body", "read", "created_at") SELECT "id", "user_id", "kind", "subject_id", "body", "read", "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe` ON `notifications` (`user_id`,`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_read` ON `notifications` (`user_id`,`read`);--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_s` integer NOT NULL,
	`distance_m` real NOT NULL,
	`lat` real,
	`lng` real,
	`indoor` integer DEFAULT false NOT NULL,
	`effort` text,
	`title` text NOT NULL,
	`weather_status` text DEFAULT 'none' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_runs`("id", "user_id", "source", "started_at", "duration_s", "distance_m", "lat", "lng", "indoor", "effort", "title", "weather_status") SELECT "id", "user_id", "source", "started_at", "duration_s", "distance_m", "lat", "lng", "indoor", "effort", "title", "weather_status" FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
CREATE INDEX `runs_user_started` ON `runs` (`user_id`,`started_at`);