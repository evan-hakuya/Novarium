CREATE TABLE `login_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_failures_ip_created_at_idx` ON `login_failures` (`ip`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_failures_created_at_idx` ON `login_failures` (`created_at`);