CREATE INDEX `email_send_limits_window` ON `email_send_limits` (`window_started_at`);--> statement-breakpoint
CREATE INDEX `password_attempts_window` ON `password_attempts` (`window_started_at`);--> statement-breakpoint
CREATE INDEX `session_expires_at` ON `session` (`expires_at`);