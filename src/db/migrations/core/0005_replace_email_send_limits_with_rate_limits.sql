CREATE TABLE `rate_limits` (
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`kind`, `subject`)
);
--> statement-breakpoint
CREATE INDEX `rate_limits_window` ON `rate_limits` (`window_started_at`);--> statement-breakpoint
DROP TABLE `email_send_limits`;
