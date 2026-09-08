ALTER TABLE `entry_photos` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `entry_photos_idempotency` ON `entry_photos` (`entry_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `imports` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `imports_idempotency` ON `imports` (`user_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `wardrobe_items` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `wardrobe_idempotency` ON `wardrobe_items` (`user_id`,`idempotency_key`);