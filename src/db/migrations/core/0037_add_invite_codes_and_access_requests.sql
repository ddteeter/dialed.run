CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_requests_email` ON `access_requests` (`email`);--> statement-breakpoint
CREATE INDEX `access_requests_status_created` ON `access_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`label` text,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`idempotency_key` text,
	`request_id` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_code` ON `invite_codes` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_idempotency` ON `invite_codes` (`created_by`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_request` ON `invite_codes` (`request_id`);--> statement-breakpoint
CREATE INDEX `invite_codes_created` ON `invite_codes` (`created_at`);--> statement-breakpoint
CREATE TABLE `invite_redemptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`email` text NOT NULL,
	`held_until` integer NOT NULL,
	`redeemed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invite_redemptions_code` ON `invite_redemptions` (`code_id`);--> statement-breakpoint
CREATE INDEX `invite_redemptions_email` ON `invite_redemptions` (`email`);