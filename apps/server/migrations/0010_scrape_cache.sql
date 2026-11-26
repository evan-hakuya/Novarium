CREATE TABLE `scrape_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`etag` text,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scrape_cache_used_at_idx` ON `scrape_cache` (`used_at`);