ALTER TABLE `takedown_requests` ADD `alerted_at` integer;--> statement-breakpoint
CREATE INDEX `takedown_requests_alerted_at` ON `takedown_requests` (`alerted_at`);