ALTER TABLE `outbox` ADD `sent_at` integer;--> statement-breakpoint
ALTER TABLE `outbox` ADD `message_id` text;