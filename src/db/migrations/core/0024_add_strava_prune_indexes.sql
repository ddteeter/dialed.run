CREATE INDEX `notifications_kind_created` ON `notifications` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_events_time` ON `processed_webhook_events` (`event_time`);