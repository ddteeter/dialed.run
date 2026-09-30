CREATE TABLE `data_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`link_token` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`claimed_at` integer,
	`ready_at` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_exports_idempotency` ON `data_exports` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_exports_link` ON `data_exports` (`link_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_exports_in_flight` ON `data_exports` (`user_id`) WHERE "data_exports"."status" IN ('pending', 'building');--> statement-breakpoint
CREATE INDEX `data_exports_user` ON `data_exports` (`user_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `data_exports_status` ON `data_exports` (`status`,`requested_at`);