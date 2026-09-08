PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_wardrobe_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
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
	`photo_key` text,
	`product_url` text,
	`product_id` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`retired` integer DEFAULT false NOT NULL,
	`visibility` text DEFAULT 'ok' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_wardrobe_items`("id", "user_id", "category", "layer", "weight", "fabric", "wind_resistant", "water_resistant", "est_temp_low_c", "est_temp_high_c", "brand", "name", "size", "color", "photo_key", "product_url", "product_id", "origin", "retired", "visibility", "created_at") SELECT "id", "user_id", "category", "layer", "weight", "fabric", "wind_resistant", "water_resistant", "est_temp_low_c", "est_temp_high_c", "brand", "name", "size", "color", "photo_key", "product_url", "product_id", "origin", "retired", "visibility", "created_at" FROM `wardrobe_items`;--> statement-breakpoint
DROP TABLE `wardrobe_items`;--> statement-breakpoint
ALTER TABLE `__new_wardrobe_items` RENAME TO `wardrobe_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `wardrobe_user_category` ON `wardrobe_items` (`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `wardrobe_product` ON `wardrobe_items` (`product_id`);