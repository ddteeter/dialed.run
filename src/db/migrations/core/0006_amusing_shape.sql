ALTER TABLE `runs` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_idempotency` ON `runs` (`user_id`,`idempotency_key`);