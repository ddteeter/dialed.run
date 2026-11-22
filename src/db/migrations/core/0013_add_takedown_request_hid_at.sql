ALTER TABLE `takedown_requests` ADD `hid_at` integer;--> statement-breakpoint
CREATE INDEX `takedown_requests_hid_at` ON `takedown_requests` (`hid_at`);