ALTER TABLE `review_queue` ADD `opened_at` integer;--> statement-breakpoint
CREATE INDEX `review_queue_source_opened` ON `review_queue` (`source`,`opened_at`);--> statement-breakpoint
-- Rows queued before the column: opened when they were created (design 164).
UPDATE `review_queue` SET `opened_at` = `created_at` WHERE `opened_at` IS NULL;
