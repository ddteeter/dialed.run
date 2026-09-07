PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`body` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "kind", "subject_id", "body", "read", "created_at") SELECT "id", "user_id", "kind", "subject_id", "body", "read", "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe` ON `notifications` (`user_id`,`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_read` ON `notifications` (`user_id`,`read`);