CREATE TABLE `email_send_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`sends` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verifications_pk` ON `email_verifications` (`user_id`,`purpose`);