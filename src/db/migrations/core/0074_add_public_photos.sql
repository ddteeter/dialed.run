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
CREATE INDEX `public_photos_user` ON `public_photos` (`user_id`);