CREATE TABLE `link_landings` (
	`url` text PRIMARY KEY NOT NULL,
	`landed_domain` text NOT NULL,
	`checked_at` integer NOT NULL
);
