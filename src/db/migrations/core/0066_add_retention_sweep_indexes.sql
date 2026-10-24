CREATE INDEX `copyright_holds_status_settled` ON `copyright_holds` (`status`,`settled_at`);--> statement-breakpoint
CREATE INDEX `moderation_actions_created` ON `moderation_actions` (`created_at`);--> statement-breakpoint
CREATE INDEX `quarantined_content_action` ON `quarantined_content` (`moderation_action_id`);--> statement-breakpoint
CREATE INDEX `reports_created` ON `reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `review_queue_resolved` ON `review_queue` (`resolved_at`);--> statement-breakpoint
CREATE INDEX `takedown_requests_resolved` ON `takedown_requests` (`resolved_at`);