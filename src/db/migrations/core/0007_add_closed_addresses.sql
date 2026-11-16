CREATE TABLE `closed_addresses` (
	`hash` text PRIMARY KEY NOT NULL,
	`closed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `closed_addresses_closed` ON `closed_addresses` (`closed_at`);