ALTER TABLE `review_queue` ADD `claimed_at` integer;--> statement-breakpoint
CREATE INDEX `review_queue_claimed` ON `review_queue` (`status`,`claimed_at`);