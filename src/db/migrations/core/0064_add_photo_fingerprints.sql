ALTER TABLE `entry_photos` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `wardrobe_items` ADD `photo_fingerprint` text;--> statement-breakpoint
CREATE INDEX `wardrobe_photo_fingerprint` ON `wardrobe_items` (`photo_fingerprint`);