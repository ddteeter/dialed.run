CREATE TABLE `fibre_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`material` text NOT NULL,
	`product_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`verbatim` text NOT NULL,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fibre_candidate_material_snapshot` ON `fibre_candidates` (`material`,`snapshot_id`);--> statement-breakpoint
CREATE INDEX `fibre_candidate_material` ON `fibre_candidates` (`material`);