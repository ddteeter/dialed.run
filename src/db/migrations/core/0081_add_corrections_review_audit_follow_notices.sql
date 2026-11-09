CREATE TABLE `follow_notices` (
	`followee_id` text NOT NULL,
	`follower_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`rung_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_notices_pair` ON `follow_notices` (`followee_id`,`follower_id`);--> statement-breakpoint
CREATE INDEX `follow_notices_notification` ON `follow_notices` (`notification_id`);--> statement-breakpoint
CREATE INDEX `follow_notices_follower` ON `follow_notices` (`follower_id`);--> statement-breakpoint
CREATE TABLE `product_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`user_id` text NOT NULL,
	`garment_id` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`reason` text,
	`decided_by` text,
	`decided_at` integer,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_corrections_waiting` ON `product_corrections` (`user_id`,`product_id`,`field`) WHERE "product_corrections"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX `product_corrections_idempotency` ON `product_corrections` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `product_corrections_queue` ON `product_corrections` (`product_id`,`field`,`value`) WHERE "product_corrections"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX `product_corrections_decided` ON `product_corrections` (`decided_at`) WHERE "product_corrections"."decided_at" is not null;--> statement-breakpoint
CREATE TABLE `review_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`review_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `review_audit_subject` ON `review_audit` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `review_audit_actor` ON `review_audit` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_audit_created` ON `review_audit` (`created_at`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `link_id` text;