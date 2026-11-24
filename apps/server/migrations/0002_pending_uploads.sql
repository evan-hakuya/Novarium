CREATE TABLE `pending_uploads` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_uploads_created_at_idx` ON `pending_uploads` (`created_at`);