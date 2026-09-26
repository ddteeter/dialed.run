CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_kind_dedupe` ON `outbox` (`kind`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `outbox_kind_due` ON `outbox` (`kind`,`next_attempt_at`);