CREATE TABLE `terms_acceptances` (
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`accepted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_acceptances_pk` ON `terms_acceptances` (`user_id`,`version`);