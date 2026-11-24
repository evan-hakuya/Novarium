CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`original_name` text NOT NULL,
	`original_size` integer NOT NULL,
	`current_version_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`version_id` text NOT NULL,
	`ord` integer NOT NULL,
	`title` text NOT NULL,
	`number` integer,
	`byte_offset` integer NOT NULL,
	`byte_length` integer NOT NULL,
	PRIMARY KEY(`version_id`, `ord`)
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`options` text NOT NULL,
	`text_size` integer NOT NULL,
	`chapter_count` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `versions_book_id_idx` ON `versions` (`book_id`);