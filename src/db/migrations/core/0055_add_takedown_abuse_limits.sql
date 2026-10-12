CREATE TABLE `takedown_blocks` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `takedown_requests` ADD `requester_key` text;--> statement-breakpoint
ALTER TABLE `takedown_requests` ADD `ip_key` text;--> statement-breakpoint
ALTER TABLE `takedown_requests` ADD `hold_state` text;--> statement-breakpoint
ALTER TABLE `takedown_requests` ADD `held_at` integer;--> statement-breakpoint
ALTER TABLE `takedown_requests` ADD `confirm_token_hash` text;--> statement-breakpoint
ALTER TABLE `takedown_requests` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `takedown_requests` ADD `poster_username` text;--> statement-breakpoint
CREATE INDEX `takedown_requests_requester_status` ON `takedown_requests` (`requester_key`,`status`);--> statement-breakpoint
CREATE INDEX `takedown_requests_ip_status` ON `takedown_requests` (`ip_key`,`status`);--> statement-breakpoint
CREATE INDEX `takedown_requests_held_at` ON `takedown_requests` (`held_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `takedown_requests_confirm_token` ON `takedown_requests` (`confirm_token_hash`);