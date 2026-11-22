CREATE TABLE `access_asks` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`note` text,
	`blocked_region` text,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`confirmed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_asks_token` ON `access_asks` (`token_hash`);--> statement-breakpoint
CREATE INDEX `access_asks_email` ON `access_asks` (`email`);--> statement-breakpoint
CREATE INDEX `access_asks_created` ON `access_asks` (`created_at`);--> statement-breakpoint
CREATE INDEX `verification_expires_at` ON `verification` (`expires_at`);