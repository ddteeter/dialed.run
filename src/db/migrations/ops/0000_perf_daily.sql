CREATE TABLE `perf_daily` (
	`day` text NOT NULL,
	`route` text NOT NULL,
	`metric` text NOT NULL,
	`device` text NOT NULL,
	`p50` real NOT NULL,
	`p75` real NOT NULL,
	`p95` real NOT NULL,
	`n` integer NOT NULL,
	PRIMARY KEY(`day`, `route`, `metric`, `device`)
);
