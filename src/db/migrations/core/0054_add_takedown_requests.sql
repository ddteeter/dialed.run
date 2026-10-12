CREATE TABLE `takedown_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_email` text NOT NULL,
	`signature` text NOT NULL,
	`location` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decline_reason` text,
	`due_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`idempotency_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `takedown_requests_idempotency` ON `takedown_requests` (`requester_email`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `takedown_requests_status_due` ON `takedown_requests` (`status`,`due_at`);