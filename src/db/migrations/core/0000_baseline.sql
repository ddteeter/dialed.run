CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`blocked_region` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_requests_email` ON `access_requests` (`email`);--> statement-breakpoint
CREATE INDEX `access_requests_status_created` ON `access_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `access_requests_status_updated` ON `access_requests` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `account_deletions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	`purge_after` integer NOT NULL,
	`purge_started_at` integer
);
--> statement-breakpoint
CREATE INDEX `account_deletions_due` ON `account_deletions` (`purge_after`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_pk` ON `blocks` (`blocker_id`,`blocked_id`);--> statement-breakpoint
CREATE INDEX `blocks_blocked` ON `blocks` (`blocked_id`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`seeded` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_normalized` ON `brands` (`normalized`);--> statement-breakpoint
CREATE TABLE `copyright_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`moderation_action_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`status` text NOT NULL,
	`hidden_at` integer NOT NULL,
	`purge_at` integer NOT NULL,
	`counter_notice_at` integer,
	`counter_notice_by` text,
	`restore_at` integer,
	`court_action_at` integer,
	`court_action_by` text,
	`case_closed_by` text,
	`settled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copyright_holds_action` ON `copyright_holds` (`moderation_action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `copyright_holds_live_subject` ON `copyright_holds` (`subject_type`,`subject_id`) WHERE "copyright_holds"."status" IN ('hidden', 'purging');--> statement-breakpoint
CREATE INDEX `copyright_holds_status_purge` ON `copyright_holds` (`status`,`purge_at`);--> statement-breakpoint
CREATE INDEX `copyright_holds_status_restore` ON `copyright_holds` (`status`,`restore_at`);--> statement-breakpoint
CREATE INDEX `copyright_holds_owner` ON `copyright_holds` (`owner_id`);--> statement-breakpoint
CREATE INDEX `copyright_holds_status_settled` ON `copyright_holds` (`status`,`settled_at`);--> statement-breakpoint
CREATE TABLE `cron_checkpoints` (
	`cron_name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`link_token` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`claimed_at` integer,
	`claim_id` text,
	`ready_at` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_exports_idempotency` ON `data_exports` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_exports_link` ON `data_exports` (`link_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_exports_in_flight` ON `data_exports` (`user_id`) WHERE "data_exports"."status" IN ('pending', 'building');--> statement-breakpoint
CREATE INDEX `data_exports_user` ON `data_exports` (`user_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `data_exports_status` ON `data_exports` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `domain_denylist` (
	`domain` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_send_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`sends` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_send_limits_window` ON `email_send_limits` (`window_started_at`);--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verifications_pk` ON `email_verifications` (`user_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `entry_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`photo_key` text NOT NULL,
	`position` integer NOT NULL,
	`idempotency_key` text,
	`fingerprint` text,
	`screen_status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_photos_screen_status` ON `entry_photos` (`screen_status`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_photos_idempotency` ON `entry_photos` (`entry_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `entry_tags` (
	`entry_id` text NOT NULL,
	`tag` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_tags_pk` ON `entry_tags` (`entry_id`,`tag`);--> statement-breakpoint
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
CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follows_pk` ON `follows` (`follower_id`,`followee_id`);--> statement-breakpoint
CREATE TABLE `gave_up` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason` text NOT NULL,
	`raw_error` text,
	`tries` integer NOT NULL,
	`first_failed_at` integer NOT NULL,
	`last_failed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gave_up_kind_subject` ON `gave_up` (`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `gave_up_last_failed` ON `gave_up` (`last_failed_at`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`failure_reason` text,
	`run_id` text,
	`created_at` integer NOT NULL,
	`idempotency_key` text,
	`garmin_activity_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imports_idempotency` ON `imports` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `imports_garmin_activity` ON `imports` (`user_id`,`garmin_activity_id`);--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`label` text,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`idempotency_key` text,
	`request_id` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_code` ON `invite_codes` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_idempotency` ON `invite_codes` (`created_by`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_request` ON `invite_codes` (`request_id`);--> statement-breakpoint
CREATE INDEX `invite_codes_created` ON `invite_codes` (`created_at`);--> statement-breakpoint
CREATE TABLE `invite_redemptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`email` text NOT NULL,
	`held_until` integer NOT NULL,
	`redeemed_at` integer NOT NULL,
	`confirmed_at` integer
);
--> statement-breakpoint
CREATE INDEX `invite_redemptions_code` ON `invite_redemptions` (`code_id`);--> statement-breakpoint
CREATE INDEX `invite_redemptions_email` ON `invite_redemptions` (`email`);--> statement-breakpoint
CREATE TABLE `link_landings` (
	`url` text PRIMARY KEY NOT NULL,
	`landed_domain` text NOT NULL,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_owner_id` text,
	`reason` text NOT NULL,
	`preserved_key` text,
	`created_at` integer NOT NULL,
	`run_id` text
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_subject` ON `moderation_actions` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `moderation_actions_owner` ON `moderation_actions` (`subject_owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `moderation_actions_run` ON `moderation_actions` (`run_id`);--> statement-breakpoint
CREATE INDEX `moderation_actions_created` ON `moderation_actions` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`email` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_pk` ON `notification_preferences` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`body` text NOT NULL,
	`link_id` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe` ON `notifications` (`user_id`,`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_read` ON `notifications` (`user_id`,`read`);--> statement-breakpoint
CREATE INDEX `notifications_kind_created` ON `notifications` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`message_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_kind_dedupe` ON `outbox` (`kind`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `outbox_kind_due` ON `outbox` (`kind`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `outfit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`verdict` integer,
	`audience` text DEFAULT 'private' NOT NULL,
	`moderation_status` text DEFAULT 'ok' NOT NULL,
	`caption` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_run` ON `outfit_entries` (`run_id`);--> statement-breakpoint
CREATE INDEX `entries_user_created` ON `outfit_entries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entries_shared_created` ON `outfit_entries` (`moderation_status`,`created_at`) WHERE "outfit_entries"."audience" in ('runners', 'world');--> statement-breakpoint
CREATE INDEX `entries_user_shared_created` ON `outfit_entries` (`user_id`,`moderation_status`,`created_at`) WHERE "outfit_entries"."audience" in ('runners', 'world');--> statement-breakpoint
CREATE INDEX `entries_user_world_created` ON `outfit_entries` (`user_id`,`moderation_status`,`created_at`) WHERE "outfit_entries"."audience" = 'world';--> statement-breakpoint
CREATE TABLE `outfit_entry_items` (
	`entry_id` text NOT NULL,
	`item_id` text NOT NULL,
	`flag` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_items_pk` ON `outfit_entry_items` (`entry_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `password_attempts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `password_attempts_window` ON `password_attempts` (`window_started_at`);--> statement-breakpoint
CREATE TABLE `photo_screenings` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_scope` text NOT NULL,
	`photo_id` text NOT NULL,
	`model` text NOT NULL,
	`scores` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photo_screenings_photo` ON `photo_screenings` (`photo_scope`,`photo_id`);--> statement-breakpoint
CREATE INDEX `photo_screenings_created` ON `photo_screenings` (`created_at`,`decision`);--> statement-breakpoint
CREATE TABLE `processed_webhook_events` (
	`object_id` text NOT NULL,
	`aspect_type` text NOT NULL,
	`event_time` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_pk` ON `processed_webhook_events` (`object_id`,`aspect_type`,`event_time`);--> statement-breakpoint
CREATE INDEX `webhook_events_time` ON `processed_webhook_events` (`event_time`);--> statement-breakpoint
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
CREATE TABLE `product_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text NOT NULL,
	`rung` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_snapshots_product_fetched` ON `product_snapshots` (`product_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`source_url` text,
	`category_hint` text,
	`type` text,
	`fabric_composition` text,
	`fabric_parts` text,
	`weight` text,
	`fabric` text,
	`wind_resistant` integer,
	`water_resistant` integer,
	`extracted` text,
	`extraction_status` text DEFAULT 'none' NOT NULL,
	`extraction_error` text,
	`extraction_tries` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_brand_name` ON `products` (`brand_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `products_extraction_failed` ON `products` (`created_at`) WHERE "products"."extraction_status" = 'failed';--> statement-breakpoint
CREATE INDEX `products_extraction_pending` ON `products` (`created_at`) WHERE "products"."extraction_status" = 'pending';--> statement-breakpoint
CREATE INDEX `products_extraction_done` ON `products` (`created_at`) WHERE "products"."extraction_status" = 'done';--> statement-breakpoint
CREATE TABLE `public_photos` (
	`key` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`published_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_photos_photo` ON `public_photos` (`photo_id`);--> statement-breakpoint
CREATE INDEX `public_photos_entry` ON `public_photos` (`entry_id`);--> statement-breakpoint
CREATE INDEX `public_photos_user` ON `public_photos` (`user_id`);--> statement-breakpoint
CREATE TABLE `quarantined_content` (
	`id` text PRIMARY KEY NOT NULL,
	`moderation_action_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`entry_id` text,
	`entry_snapshot` text NOT NULL,
	`photos_snapshot` text NOT NULL,
	`quarantined_at` integer NOT NULL,
	`retain_until` integer NOT NULL,
	`ncmec_reported_at` integer,
	`ncmec_report_id` text,
	`uploader_snapshot` text
);
--> statement-breakpoint
CREATE INDEX `quarantined_content_quarantined` ON `quarantined_content` (`quarantined_at`);--> statement-breakpoint
CREATE INDEX `quarantined_content_retain` ON `quarantined_content` (`retain_until`);--> statement-breakpoint
CREATE INDEX `quarantined_content_action` ON `quarantined_content` (`moderation_action_id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'useful' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_pk` ON `reactions` (`entry_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `reminder_email_days` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`covered_until` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_email_days_user_day` ON `reminder_email_days` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `reminder_email_days_covered_until` ON `reminder_email_days` (`covered_until`);--> statement-breakpoint
CREATE TABLE `removed_fingerprints` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`photo_id` text,
	`moderation_action_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `removed_fingerprints_created` ON `removed_fingerprints` (`created_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_one_per_reporter` ON `reports` (`reporter_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `reports_subject` ON `reports` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `reports_created` ON `reports` (`created_at`);--> statement-breakpoint
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
CREATE TABLE `review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`opened_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_queue_subject` ON `review_queue` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `review_queue_claimed` ON `review_queue` (`status`,`claimed_at`);--> statement-breakpoint
CREATE INDEX `review_queue_status_created` ON `review_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_queue_resolved` ON `review_queue` (`resolved_at`);--> statement-breakpoint
CREATE INDEX `review_queue_source_opened` ON `review_queue` (`source`,`opened_at`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_s` integer NOT NULL,
	`distance_m` real NOT NULL,
	`lat` real,
	`lng` real,
	`indoor` integer DEFAULT false NOT NULL,
	`effort` text,
	`title` text NOT NULL,
	`idempotency_key` text,
	`weather_status` text DEFAULT 'none' NOT NULL,
	`reminder_matched_at` integer,
	`moving_s` integer,
	`elevation_gain_m` real,
	`rpe` integer,
	`effort_source` text,
	`device_name` text
);
--> statement-breakpoint
CREATE INDEX `runs_user_started` ON `runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_idempotency` ON `runs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `strava_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`refresh_token` text NOT NULL,
	`connected_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strava_connections_athlete` ON `strava_connections` (`athlete_id`);--> statement-breakpoint
CREATE TABLE `strava_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`refresh_token` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `takedown_blocks` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
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
	`idempotency_key` text NOT NULL,
	`requester_key` text,
	`ip_key` text,
	`hold_state` text,
	`held_at` integer,
	`confirm_token_hash` text,
	`confirmed_at` integer,
	`poster_username` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `takedown_requests_idempotency` ON `takedown_requests` (`requester_email`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `takedown_requests_status_due` ON `takedown_requests` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `takedown_requests_requester_status` ON `takedown_requests` (`requester_key`,`status`);--> statement-breakpoint
CREATE INDEX `takedown_requests_ip_status` ON `takedown_requests` (`ip_key`,`status`);--> statement-breakpoint
CREATE INDEX `takedown_requests_held_at` ON `takedown_requests` (`held_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `takedown_requests_confirm_token` ON `takedown_requests` (`confirm_token_hash`);--> statement-breakpoint
CREATE INDEX `takedown_requests_resolved` ON `takedown_requests` (`resolved_at`);--> statement-breakpoint
CREATE TABLE `terms_acceptances` (
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`accepted_at` integer NOT NULL,
	`how` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_acceptances_pk` ON `terms_acceptances` (`user_id`,`version`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text,
	`city_label` text,
	`lat` real,
	`lng` real,
	`time_zone` text,
	`d1_bookmark` text,
	`d1_bookmark_at` integer,
	`thermal_level` integer,
	`temp_unit` text,
	`distance_unit` text,
	`default_audience` text DEFAULT 'runners' NOT NULL,
	`onboarding_complete` integer DEFAULT false NOT NULL,
	`banned_at` integer,
	`ban_reason` text,
	`username_reset_reason` text,
	`username_screen` text,
	`username_screened_at` integer,
	`count_in_totals` integer DEFAULT true NOT NULL,
	`public_profile` integer DEFAULT false NOT NULL,
	`public_closet` integer DEFAULT false NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_profiles_username_screen_pending` ON `user_profiles` (`username_screen`) WHERE "user_profiles"."username_screen" IN ('unknown', 'checking');--> statement-breakpoint
CREATE INDEX `user_profiles_zone_owed` ON `user_profiles` (`user_id`) WHERE "user_profiles"."time_zone" IS NULL AND "user_profiles"."lat" IS NOT NULL AND "user_profiles"."lng" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_username_nocase` ON `user_profiles` ("username" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `user_profiles_banned_at` ON `user_profiles` (`banned_at`) WHERE "user_profiles"."banned_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `username_history` (
	`username` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`retired_at` integer NOT NULL,
	`locked_at` integer
);
--> statement-breakpoint
CREATE INDEX `username_history_user` ON `username_history` (`user_id`);--> statement-breakpoint
CREATE TABLE `wardrobe_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`type` text,
	`layer` text,
	`weight` text,
	`fabric` text,
	`wind_resistant` integer,
	`water_resistant` integer,
	`est_temp_low_c` real,
	`est_temp_high_c` real,
	`brand` text,
	`name` text NOT NULL,
	`size` text,
	`color` text,
	`color_name` text,
	`color_hex` text,
	`visibility_level` text,
	`photo_key` text,
	`photo_fingerprint` text,
	`product_url` text,
	`product_id` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`idempotency_key` text,
	`retired` integer DEFAULT false NOT NULL,
	`retired_at` integer,
	`visibility` text DEFAULT 'ok' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wardrobe_user_category` ON `wardrobe_items` (`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `wardrobe_product` ON `wardrobe_items` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wardrobe_idempotency` ON `wardrobe_items` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE INDEX `rate_limit_last_request` ON `rate_limit` (`last_request`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_expires_at` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier` ON `verification` (`identifier`);